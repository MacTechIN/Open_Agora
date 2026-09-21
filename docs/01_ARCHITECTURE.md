# 01. 시스템 아키텍처 및 데이터 명세

## 1. 전체 토폴로지

중앙 데이터베이스가 존재하지 않습니다. 네 개 계층으로 구성됩니다.

```
┌─ 계층 1: 네이티브 클라이언트 ──────────────────────────────┐
│  Windows (WinUI 3)          Android (Jetpack Compose)     │
│         └──────────┬──────────────────┘                   │
│            공유 Rust 코어 (civicagora-core)                │
│            · P-256 키 (플랫폼 하드웨어 저장소가 보관)      │
│            · ZK 증명 생성 (rapidsnark, 네이티브)           │
│            · rust-libp2p 노드 (GossipSub, NAT 통과)        │
│            · 로컬 캐시 (SQLite) 및 오프라인 큐             │
└──────────────────────────┬────────────────────────────────┘
                           │
┌─ 계층 2: P2P 데이터 ──────▼────────────────────────────────┐
│  Ceramic ComposeDB — 안건, 토론 카드, 댓글, 반응 이벤트    │
│  IPFS 블록스토어 — 원문 영구 보존                          │
│  libp2p GossipSub — 피어 동기화 (mDNS + STUN/TURN/DCUtR)   │
└──────────────────────────┬────────────────────────────────┘
                           │
┌─ 계층 3: 연산 서비스 ─────▼────────────────────────────────┐
│  AI 톤 코칭 서빙 (FastAPI + vLLM)                          │
│  브리징 행렬 분해 / Pol.is 클러스터링 배치 잡              │
│  대정부 브리프 생성기 · 연구자 오픈 API                    │
│  ※ 검증 가능한 재현 노드. 누구나 동일 입력으로 재계산 가능 │
└──────────────────────────┬────────────────────────────────┘
                           │ 주기적 Merkle State Root 앵커링
┌─ 계층 4: 온체인 ──────────▼────────────────────────────────┐
│  EVM L2 (Arbitrum / Polygon)                               │
│  · ZK-Email Nullifier 레지스트리 (1인 1계정)               │
│  · 안건별 상태 머클 루트 (위변조 증명)                     │
│  · 평판 마일스톤 배지 (Soulbound Token)                    │
└────────────────────────────────────────────────────────────┘
```

### 1.1 계층 3이 중앙화되지 않는 이유

AI 추론과 행렬 분해는 개인 단말에서 돌릴 수 없어 서버가 필요합니다. 이것이 중앙 통제로 변질되지 않도록 다음을 강제합니다.

* 계층 3은 **데이터를 소유하지 않습니다.** 입력은 전부 계층 2의 공개 데이터이고, 산출물(브리징 점수, 클러스터 좌표)도 계층 2에 서명된 형태로 되돌아갑니다.
* 모든 배치 잡은 **결정론적**이어야 합니다. 입력 스냅샷 해시, 모델 버전, 시드, 하이퍼파라미터를 산출물에 함께 기록합니다.
* 제3자가 같은 스냅샷으로 재계산해 불일치를 증명할 수 있습니다. 조작 시 즉시 발각됩니다.
* 톤 코칭 결과는 **구속력이 없습니다.** 사용자는 언제나 원문 게시를 선택할 수 있으므로, 서버가 악의적이어도 검열이 성립하지 않습니다.

---

## 2. 온체인 / 오프체인 분리 원칙

> **읽을 수 있는 모든 것은 오프체인, 증명할 수 있는 것만 온체인.**

| 데이터 | 위치 | 이유 |
|-|-|-|
| 안건·카드·댓글 본문 | 오프체인 (IPFS/Ceramic) | 용량과 비용. 원문 자체는 P2P 복제로 불변 |
| 반응 이벤트 로그 | 오프체인 | 고빈도. 집계 결과만 앵커링 |
| 상태 머클 루트 | 온체인 | 오프체인 데이터의 위변조를 수학적으로 증명 |
| Nullifier | 온체인 | 1인 1계정을 전역적으로 강제하려면 단일 레지스트리가 필요 |
| 평판 마일스톤 배지 | 온체인 (SBT) | 낮은 변경 빈도. 양도 불가 |
| 평판 점수(가변) | 오프체인 | 매일 재계산되므로 온체인 기록은 가스비만 낭비 |
| 실명·이메일 | **어디에도 없음** | 시스템이 보관하지 않음 (→ `02_IDENTITY_PRIVACY.md`) |
| 정치 성향 입력값 | 본인 단말에만 암호화 저장 | 절대 비노출 (→ D7) |

### 2.1 앵커링 주기

* **정기 앵커링**: 6시간마다, 안건별 상태 머클 루트를 갱신합니다.
* **이벤트 앵커링**: 합의 배너 승격, 대정부 브리프 발행 시 즉시 앵커링합니다.
* 앵커링 트랜잭션 비용은 L2 기준 안건당 월 수백 원 수준이며, 여러 안건의 루트를 하나의 머클 트리로 묶어 단일 트랜잭션으로 제출합니다.

---

## 3. 데이터 모델 스키마

> ⚠️ **잠정.** 아래는 ComposeDB 기준으로 작성되었으나, VS-C0 조사 결과
> ComposeDB는 사실상 중단된 상태입니다(마지막 릴리스 2024-02-27, 현재 Ceramic
> 문서에 부재). **데이터 계층을 재선정할 때까지 이 절의 스키마는 확정이
> 아닙니다.** 모델 구조와 필드 정의는 유효하되, 표현 문법과
> `accountRelation: SET` 같은 플랫폼 고유 기능은 대체 스택에 맞춰 바뀝니다.
> → `13_VS_C0_FINDINGS.md` §2, 신규 슬라이스 VS-B2′

### 3.1 ComposeDB 표현 (잠정)

```graphql
type Policy @createModel(accountRelation: LIST, description: "토론 안건") {
  author: DID! @documentAccount
  title: String! @string(maxLength: 60)
  category: PolicyCategory!
  background: String! @string(maxLength: 300)
  coreQuestion: String! @string(maxLength: 100)
  officialSourceUrl: String! @string(maxLength: 500)
  targetAgency: String @string(maxLength: 100)
  deadline: DateTime
  createdAt: DateTime!
}

type DebateCard @createModel(accountRelation: LIST, description: "토론 카드") {
  author: DID! @documentAccount
  policyId: StreamID! @documentVersion
  stance: StanceType!
  problemDefinition: String! @string(maxLength: 150)
  evidenceSource: String! @string(maxLength: 200)
  evidenceUrl: String! @string(maxLength: 500)
  actionableSolution: String! @string(maxLength: 150)
  toxicityScore: Float!
  wasRevisionRejected: Boolean!
  createdAt: DateTime!
}

type Reply @createModel(accountRelation: LIST, description: "카드 댓글") {
  author: DID! @documentAccount
  cardId: StreamID! @documentVersion
  body: String! @string(maxLength: 500)
  toxicityScore: Float!
  wasRevisionRejected: Boolean!
  createdAt: DateTime!
}

type Reaction @createModel(accountRelation: SET, description: "카드 반응") {
  author: DID! @documentAccount
  cardId: StreamID! @documentVersion
  kind: ReactionKind!
  createdAt: DateTime!
}

enum StanceType     { SUPPORT  ALTERNATIVE  OPPOSE }
enum ReactionKind   { LOGICAL  EMPATHY  NEEDS_FACTCHECK  DISAGREE }
enum PolicyCategory { GOV_POLICY  LEGISLATION  PARTY_POLICY  LOCAL  PUBLIC_ORG  SOCIAL_ISSUE  WHISTLEBLOW }
```

**설계 주석**

* `Reaction`은 `accountRelation: SET`으로 선언해 (작성자, 카드) 쌍의 유일성을 프로토콜 수준에서 강제합니다. 한 사람이 한 카드에 두 번 반응할 수 없습니다.
* `evidenceUrl`은 `String!`(필수)입니다. 기존 문서의 선택 필드 정의는 폐기되었습니다(→ D8).
* `toxicityScore`와 `wasRevisionRejected`를 본문과 함께 저장해, 디랭킹 근거가 사후 조작될 수 없게 합니다.
* 평판 점수는 스키마에 없습니다. 파생값이므로 계층 3이 매일 재계산합니다.

---

## 4. 온체인 컨트랙트

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IZKEmailVerifier {
    function verifyProof(bytes calldata proof, uint256[] calldata publicSignals)
        external view returns (bool);
}

contract CivicAgoraCore {
    struct PolicyAnchor {
        bytes32 rootHash;         // Ceramic 상태 머클 루트
        uint32  participantCount; // 누적 참여 시민 수
        uint16  convergenceBps;   // 수렴도, basis point (0~10000)
        uint64  timestamp;
    }

    IZKEmailVerifier public immutable verifier;

    mapping(bytes32 => bool)        public nullifierRegistry; // 중복 가입 방지
    mapping(uint256 => PolicyAnchor) public policyAnchors;

    event CitizenRegistered(bytes32 indexed nullifier);
    event StateAnchored(uint256 indexed policyId, bytes32 rootHash, uint16 convergenceBps);

    error AlreadyRegistered();
    error InvalidProof();

    constructor(IZKEmailVerifier _verifier) { verifier = _verifier; }

    function verifyAndRegister(bytes32 nullifier, bytes calldata zkProof, uint256[] calldata publicSignals)
        external
    {
        if (nullifierRegistry[nullifier]) revert AlreadyRegistered();
        if (!verifier.verifyProof(zkProof, publicSignals)) revert InvalidProof();
        nullifierRegistry[nullifier] = true;
        emit CitizenRegistered(nullifier);
    }
}
```

**수치 표현 규약**: 브리징 지수와 수렴도는 실수이지만 Solidity에는 부동소수점이 없습니다. **basis point(0~10000) 정수**로 인코딩합니다. 예: 수렴도 72.4% → `7240`. 기존 문서의 `uint256 bridgingScore`는 스케일이 정의되지 않아 모호했으므로 이렇게 확정합니다.

---

## 5. P2P 네트워킹

* **전송**: QUIC 우선, TCP 폴백. Android 이동통신망에서 QUIC의 연결 마이그레이션이 큰 이점을 줍니다.
* **피어 발견**: 로컬 네트워크는 mDNS, 광역은 Kademlia DHT + 부트스트랩 노드.
* **NAT 통과**: AutoNAT로 도달 가능성을 판정하고, Circuit Relay v2 + DCUtR(홀펀칭)로 승격합니다. 실패 시 TURN 릴레이로 폴백합니다. 가정용 공유기 하위 환경이 다수이므로 릴레이 노드 운영이 필수입니다.
* **메시지 전파**: GossipSub v1.1. 안건별 토픽(`/civicagora/policy/{id}/v1`)으로 분리해 관심 없는 안건의 트래픽을 받지 않습니다.
* **모바일 절전**: Android 클라이언트는 포그라운드에서만 전체 GossipSub에 참여하고, 백그라운드에서는 구독 안건의 헤더만 동기화합니다(→ `05_CLIENT_APPS.md`).
