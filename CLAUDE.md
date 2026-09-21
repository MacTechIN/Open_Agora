# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 저장소 현재 상태

**코드가 없습니다.** 이 저장소는 현재 `docs/` 아래 명세 문서만 존재하는 설계 단계 프로젝트이며, git 저장소도 아직 아닙니다. 빌드/린트/테스트 명령이 존재하지 않으므로, 구현을 시작할 때 스캐폴딩과 함께 이 섹션을 실제 명령으로 교체해야 합니다.

문서에서 선언된(아직 설치되지 않은) 목표 스택:

| 레이어 | 스택 |
|-|-|
| 프론트엔드 | Next.js 15 (App Router) + Tailwind CSS |
| AI 서빙 | Python FastAPI + vLLM |
| 영지식 증명 | Circom 회로 + SnarkJS (브라우저 Wasm) |
| P2P 데이터 | Ceramic ComposeDB, Helia IPFS, js-libp2p (GossipSub) |
| 온체인 | Solidity ^0.8.24, EVM L2 (Arbitrum/Polygon) |
| 오픈 데이터 | DuckDB / Parquet + REST |

## 프로젝트 개요

CivicAgora는 탈중앙 정책 공론장이다. 세 가지 축이 서로를 제약한다:

1. **무신뢰 불변성** — 중앙 서버가 데이터를 검열·삭제·왜곡할 수 없어야 한다. 본문은 오프체인 P2P(Ceramic/IPFS)에, 상태 증명(머클 루트)만 온체인에 앵커링한다.
2. **진영 논리 차단** — 단순 다수결이 아니라 *브리징*으로 순위를 매긴다. 상반된 이념 성향 집단 양쪽 모두에게 긍정 평가를 받은 글만 상위 노출된다. 몰표·좌표찍기는 구조적으로 무력화된다.
3. **처벌이 아닌 유도** — AI 톤 코칭은 차단기가 아니라 작성 단계의 코치다. 사용자는 항상 원문 강행 게시를 선택할 수 있고, 대신 평판 점수 차감과 디랭킹을 감수한다.

## 아키텍처 (3계층)

```
[브라우저 / 로컬 노드]  로컬 키페어(Secp256k1 DID) · ZK 증명 생성(SnarkJS/Wasm) · Helia+libp2p
        │
[P2P 데이터 계층]       ComposeDB on Ceramic — 정책 본문, 토론 카드, 반응 이벤트 로그
        │               GossipSub 피어 동기화 (mDNS + STUN/TURN)
        │  주기적 Merkle State Root 앵커링
[EVM L2 컨트랙트]       Nullifier 레지스트리(1인 1계정) · 안건별 상태 머클 루트 · 평판 SBT
```

핵심 데이터 분리 원칙: **읽을 수 있는 모든 것은 오프체인, 증명할 수 있는 것만 온체인.** 온체인에는 이메일·실명·본문이 절대 올라가지 않는다 (`CivicAgoraCore` 컨트랙트 스케치는 `docs/01_SYSTEM_ARCHITECTURE.md` 참조).

신원 파이프라인: 인증 메일의 DKIM RSA 서명을 클라이언트 내 Circom 회로로 검증 → `Nullifier Hash = Poseidon(Email, AppSalt)` 산출 → 이메일 원문·실명 폐기 → Nullifier + ZK Proof만 컨트랙트 전송 → 중복 대조 후 `Citizen_XXXX` 식별자 발급.

## 알고리즘 계약

**브리징 행렬 분해** (Community Notes 변형): `r̂(u,i) = μ + b_u + b_i + f_u · f_i`, L2 정규화 손실 최소화. `b_i`(고유 품질/브리징 점수)가 랭킹 기준이고, `f_i`(이념 편향 벡터)가 0에 가까울 때만 `b_i`가 커진다. **같은 진영의 몰표는 `f_u · f_i` 항이 흡수하므로 `b_i`를 올리지 못한다** — 이 성질이 깨지면 플랫폼의 존재 이유가 사라지므로, 랭킹 코드 변경 시 최우선 회귀 검증 대상이다.

**Pol.is 합의 추출**: 유저×의견 희소 행렬 → PCA 2차원 투영 → K-Means 군집화 → 모든 군집에서 임계치 이상 찬성률을 얻은 '대안' 카드만 공식 권고안 후보로 승격.

**AI 톤 코칭 3단계**: 고속 유해성 스크리닝(<30ms) → 멀티라벨 정밀 분류 → 경량 LLM 순화문 생성. 순화 제안은 **작성자의 비판 취지를 100% 보존**해야 하며, 출력은 `toxicity_score` / `detected_violations` / `suggested_revision` JSON이다. 모델 후보: `smilegate-ai/kor_unsmile`, `beomi/KcELECTRA-base-v2022`, `yanolja/EEVE-Korean-Instruct-10.8B`.

**평판 점수**: 제안 작성 +10, 반대 진영으로부터 긍정 반응 +5/건, 대정부 브리프 수록 +100, 순화 거부 강행 -30, 악의적 비방 댓글 -50 및 7일 작성 정지.

## 문서 지도

- `docs/index.md` — 문서 색인 및 4단계(16주) 로드맵. Phase 1 신원/데이터 → Phase 2 합의/톤코칭 → Phase 3 프론트/P2P → Phase 4 대정부 파이프라인/오픈 API.
- `docs/project_definition.md` — **원본 요구사항.** 이해관계자가 직접 쓴 평문이며, 아래 충돌 목록에서 다른 문서와 어긋날 때 무엇이 원래 의도였는지 판단하는 기준.
- `docs/01_SYSTEM_ARCHITECTURE.md` — 토폴로지, ZK-Email 파이프라인, ComposeDB GraphQL 스키마, Solidity 스케치. 파일 하단에 `02_ALGORITHM_AND_AI.md`가 될 내용이 코드펜스 밖으로 새어나와 그대로 이어붙어 있다.
- `docs/algorithms_ai_pipeline_specification.md` — 알고리즘 상세 (01 하단 내용의 확장판, 수치는 불일치).
- `docs/03_SERVICE_SPEC_AND_API.md` — 3축 입력 UI 스펙, 평판/배지 정책, 대정부 브리프 포맷, 연구자용 오픈 API (`GET /api/v1/research/opinions/export`).
- `docs/research.md` — 기술 선정 근거 및 참조 오픈소스 (zkemail, spruceid/ssi, twitter/communitynotes, pol-is, ceramic, helia, libp2p).

## 구현 전에 반드시 해소해야 할 명세 충돌

문서들이 서로 다른 시점에 작성되어 상충한다. 해당 영역을 구현할 때는 임의로 한쪽을 고르지 말고 사용자에게 확인할 것.

1. **익명성 vs 실명 공개 (가장 중요).** `project_definition.md`는 "회원 ID는 이메일 주소로 unique", "등록자명과 아이디(이메일)이 공개"를 요구한다. 반면 `01_SYSTEM_ARCHITECTURE.md`의 ZK-Email 설계는 이메일과 실명을 **폐기**하고 `Citizen_XXXX` 가명만 남긴다. 두 요구는 양립 불가능하며, 신원 레이어 전체 설계를 좌우한다.
2. **찬반 2축 vs 3축 스탠스.** 원본 요구는 찬성/반대 좌우 2분할 목록이다. 스키마와 UI 스펙은 `ENDORSE | CONCERN | ALTERNATIVE` 3축 구조화 카드(150/200/150자)다.
3. **반응 아이콘 세트.** 원본은 카카오톡식 좋아요/반대해요/별로에요/추천해요. 명세는 💡논리적 / 🤝공감 / 🔍팩트체크 / ⚖️대안. 오픈 API 응답 필드는 후자(`logical`, `empathy`, `needs_factcheck`, `suggests_alternative`) 기준.
4. **합의 임계치.** 01 하단은 양 군집 모두 **0.65** 이상, `algorithms_ai_pipeline_specification.md`는 **0.60** 이상.
5. **톤 코칭 파이프라인 순서와 임계치.** 01 하단: Kor-Unsmile 1차 스캔, score ≥ **0.3**이면 LLM 단계 진입. algorithms 문서: KcELECTRA 1차 → KorUnsmile 정밀 분류, score > **0.65**에서 배너 트리거. 모델 순서와 숫자 모두 다르다.
6. **누락 문서.** `index.md`가 참조하는 `docs/02_ALGORITHM_AND_AI.md`는 존재하지 않는다.

## 문서 편집 시 주의

`docs/` 내 마크다운 상당수가 외부 편집기에서 붙여넣어지며 이스케이프가 깨져 있다 (`\*`, `\#`, `\\[`, `&#x20;`, `$$...$$` 내부의 `\\`). 문서를 수정할 때 이 손상을 그대로 확산시키지 말고, 손대는 구역은 정상 마크다운으로 복구할 것. 수식은 LaTeX(`$...$`, `$$...$$`)로 표기한다.

## 언어

모든 문서와 제품 UI는 한국어다. AI 모델 선정도 한국어 정치 커뮤니티의 신조어·은어·초성 비하 탐지를 전제로 한다. 사용자 대면 문자열, 커밋 메시지, 문서는 한국어로 작성한다.
