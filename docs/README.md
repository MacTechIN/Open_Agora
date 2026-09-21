# CivicAgora 통합 명세서 (docs)

이 폴더는 **단일 진실 공급원(Single Source of Truth)** 입니다. 기존 초기 문서들(`ref_docs/`)은 서로 상충하는 내용을 담고 있어 **아카이브(참고용, 비권위)** 로 강등되었습니다. 구현 시 상충이 발견되면 언제나 `docs/`가 우선합니다.

## 문서 체계

| 문서 | 내용 |
|-|-|
| [`00_PRODUCT_SPEC.md`](./00_PRODUCT_SPEC.md) | 제품 정의, 3열 토론 구조, 입력 포맷, 반응, 댓글, 정책 등록 |
| [`01_ARCHITECTURE.md`](./01_ARCHITECTURE.md) | 4계층 토폴로지, 온/오프체인 데이터 분리, 스키마 |
| [`02_IDENTITY_PRIVACY.md`](./02_IDENTITY_PRIVACY.md) | ZK-Email 신원 파이프라인, 필명 체계, 프라이버시 불변식 |
| [`03_ALGORITHMS_AI.md`](./03_ALGORITHMS_AI.md) | 브리징 행렬 분해, Pol.is 합의 추출, AI 톤 코칭 |
| [`04_REPUTATION_MODERATION.md`](./04_REPUTATION_MODERATION.md) | 평판 점수, 배지, 제재, 블라인드 정책 |
| [`05_CLIENT_APPS.md`](./05_CLIENT_APPS.md) | 네이티브 Windows / Android 앱 아키텍처 |
| [`06_GOV_BRIEF_API.md`](./06_GOV_BRIEF_API.md) | 대정부 합의 브리프, 연구자 오픈 데이터 API |
| [`07_ROADMAP.md`](./07_ROADMAP.md) | 개정 개발 로드맵 |
| [`08_DECISIONS.md`](./08_DECISIONS.md) | **검증 기록.** 기존 문서 충돌 14건의 확정 결론과 근거 |
| [`09_DEVELOPMENT_PLAN.md`](./09_DEVELOPMENT_PLAN.md) | **개발계획서.** 38개 수직 슬라이스, 의존 그래프, 스텁 교체 원장 |
| [`10_AI_JUDGMENTS.md`](./10_AI_JUDGMENTS.md) | AI 판단 지점의 구조화 결정 설계와 기존 방식 비교 |
| [`11_SOVEREIGN_JUDGMENT.md`](./11_SOVEREIGN_JUDGMENT.md) | **주권 판단 계층.** 제약 채점, 정본 재현, 모델 앵커링, G-BIAS 게이트 |
| [`12_ONCHAIN_DEPENDENCIES.md`](./12_ONCHAIN_DEPENDENCIES.md) | 온체인 계층에서 직접 만들 것과 기존 서비스로 대체할 것 |

## 읽는 순서

처음 합류한다면 `00` → `02` → `01` → `03` 순서를 권합니다. 구현을 시작한다면 `09_DEVELOPMENT_PLAN.md`가 작업 단위와 순서를 정의합니다. 기존 `ref_docs/`를 이미 읽었다면 **`08_DECISIONS.md`를 먼저** 읽으십시오. 무엇이 왜 바뀌었는지가 모두 거기에 있습니다.

## 확정된 핵심 결정 요약

1. **신원** — ZK-Email로 1인 1계정만 검증하고, 공개되는 것은 변경 불가 필명뿐입니다. 실명·이메일은 시스템이 보관하지 않습니다.
2. **토론 구조** — 찬성 / 대안·합의 / 반대 3열. 가운데 열이 브리징 알고리즘의 결과물입니다.
3. **삭제** — 없습니다. 디랭킹 → 블라인드 → 검색 제외 3단계로만 대응합니다.
4. **반응** — 긍정 2종(💡🤝) + 부정 2종(🔍⚖️). 브리징 이진 신호 `r ∈ {0,1}`에 직결됩니다.
5. **클라이언트** — 네이티브 Windows(WinUI 3) + 네이티브 Android(Jetpack Compose), 공유 Rust 코어.
