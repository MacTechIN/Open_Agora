# 01\. 시스템 아키텍처 및 탈중앙 데이터 명세서

## 1\. 전체 네트워크 토폴로지

CivicAgora는 중앙 데이터베이스에 의존하지 않으며, 클라이언트 노드, P2P 오프체인 스토리지, L2 앵커링 블록체인의 3계층 구조로 구동됩니다.



\[사용자 브라우저 / 로컬 노드]

├── 1. 로컬 키페어 (Secp256k1 DID)

├── 2. ZK-Email 증명 생성기 (SnarkJS / Wasm)

└── 3. P2P 네트워킹 (Helia IPFS + libp2p)

│

▼

\[P2P 데이터 계층 (ComposeDB on Ceramic)]

├── 500자 정책 제안 원문 \& 3축 토론 카드

├── 상호 반응(💡, 🤝, 🔍, ⚖️) 이벤트 로그

└── GossipSub 기반 피어 동기화 (mDNS + STUN/TURN)

│

▼ (주기적 Merkle State Root 앵커링)

\[블록체인 스마트 컨트랙트 (EVM L2: Arbitrum/Polygon)]

├── ZK-Email Nullifier 레지스트리 (1인 1계정 검증)

├── 안건별 상태 머클 루트 (데이터 위변조 증명)

└── 사용자 브리징 평판 토큰 (Soulbound Token)



\---



\## 2. ZK-Email 기반 프라이버시 신원 파이프라인

\* \*\*가입 단계:\*\*

&#x20; 1. 사용자가 정부/포털 도메인의 이메일로 발송된 인증 메일을 수신.

&#x20; 2. 클라이언트 내부 브라우저에서 DKIM RSA 서명을 검증하는 Circom 회로 실행.

&#x20; 3. 회로는 이메일 주소의 원문 해시와 솔트(Salt)를 결합하여 `Nullifier Hash = Poseidon(Email, AppSalt)`를 산출.

&#x20; 4. 실제 이메일과 사용자 이름은 폐기되며, 오직 `Nullifier Hash`와 ZK Proof만 스마트 컨트랙트로 전송.

&#x20; 5. 컨트랙트는 해당 Nullifier가 등록된 적이 없는지 대조 후 `Citizen\_XXXX` 고유 식별자 발급.



\---



\## 3. 온체인/오프체인 데이터 분리 스키마



\### Ceramic ComposeDB 스키마 (오프체인: 본문 및 구조화 데이터)

```graphql

type DebateCard @createModel(accountRelation: LIST, description: "3축 토론 카드") {

&#x20; author: DID! @documentAccount

&#x20; policyId: StreamID! @documentVersion

&#x20; stance: StanceType! # ENDORSE | CONCERN | ALTERNATIVE

&#x20; problemDefinition: String! @string(maxLength: 150)

&#x20; evidenceSource: String! @string(maxLength: 200)

&#x20; evidenceUrl: String @string(maxLength: 500)

&#x20; actionableSolution: String! @string(maxLength: 150)

&#x20; createdAt: DateTime!

}



enum StanceType {

&#x20; ENDORSE

&#x20; CONCERN

&#x20; ALTERNATIVE

}





Solidity 스마트 컨트랙트 스키마 (온체인: 상태 증명)

Solidity

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;



contract CivicAgoraCore {

&#x20;   struct PolicyAnchor {

&#x20;       bytes32 rootHash;        // Ceramic 상태 머클 루트

&#x20;       uint256 participantCount;// 누적 참여자 수

&#x20;       uint256 bridgingScore;   // 집계된 브리징 합의 지수

&#x20;       uint256 timestamp;

&#x20;   }



&#x20;   mapping(bytes32 => bool) public nullifierRegistry; // ZK-Email 중복 방지

&#x20;   mapping(uint256 => PolicyAnchor) public policyAnchors; // 안건 ID => 상태 기록



&#x20;   event StateAnchored(uint256 indexed policyId, bytes32 rootHash, uint256 bridgingScore);



&#x20;   function verifyAndRegister(bytes32 nullifier, bytes calldata zkProof) external {

&#x20;       require(!nullifierRegistry\[nullifier], "Already registered citizen");

&#x20;       // ZK Proof 검증 로직 실행

&#x20;       nullifierRegistry\[nullifier] = true;

&#x20;   }

}



\---



\### 4. `docs/02\_ALGORITHM\_AND\_AI.md`

```markdown

\# 02. 알고리즘 및 AI 모듈 명세서



\## 1. 진영 논리 차단: 브리징 지수(Bridging Index) 수학적 모델



단순 찬반 다수결 투표는 양극화된 지지층의 '좌표 찍기'에 취약합니다. Twitter Community Notes의 행렬 분해(Matrix Factorization) 수식을 정책 토론에 맞추어 변형 적용합니다.



\### 예측 평점 모델

사용자 $u$가 작성글 $i$에 긍정 반응(추천/공감)을 보일 확률 $P(r\_{ui} = 1)$은 다음과 같이 모델링됩니다:



$$\\hat{r}\_{ui} = \\sigma(\\mu + i\_u + i\_i + f\_u \\cdot f\_i)$$



\* $\\mu$: 시스템 전체의 기본 평균 반응률.

\* $i\_u$: 사용자 $u$의 평가 관대함 지수 (User Intercept).

\* $i\_i$: 작성글 $i$의 일반적 수용성 지수 (Note Intercept).

\* $f\_u$: 사용자 $u$의 잠재 정치적 성향 벡터 (User Factor).

\* $f\_i$: 작성글 $i$가 특정 진영에 어필하는 편향 벡터 (Note Factor).



\### 브리징 제안(Consensus) 채택 조건

작성글 $i$가 최상위 추천으로 올라서기 위해서는 두 가지 조건을 동시에 만족해야 합니다:

1\. \*\*높은 일반 수용성:\*\* $i\_i > \\tau\_{\\text{approval}}$ (전체 평가자 다수가 긍정).

2\. \*\*이념적 중립 수렴:\*\* $|f\_i| \\approx 0$ (특정 진영 성향 $f\_u > 0$과 반대 성향 $f\_u < 0$ 양쪽 모두로부터 고른 지지를 획득).



\---



\## 2. Pol.is 다차원 의견 클러스터링 알고리즘

1\. \*\*투표 행렬 구성:\*\* $N \\times M$ 행렬 생성 ($N$: 참여 시민 수, $M$: 안건 내 하위 의견 수).

2\. \*\*PCA(주성분 분석):\*\* 고차원 투표 행렬을 2차원 평면(PC1, PC2)으로 투영하여 가시화.

3\. \*\*K-Means 클러스터링:\*\* 성향 집단을 그룹 A, 그룹 B로 자동 군집화.

4\. \*\*합의점(Consensus Statement) 추출 기준:\*\*

&#x20;  $$\\text{Agreement}(Group\_A) \\ge 0.65 \\quad \\land \\quad \\text{Agreement}(Group\_B) \\ge 0.65$$

&#x20;  양대 군집 모두에서 65% 이상의 찬성을 얻은 대안 카드만 "공식 정책 권고안" 후보로 승격.



\---



\## 3. 실시간 AI 톤 코칭 파이프라인



\[사용자 500자 입력]

│

▼

\[Step 1: Toxic 점수 스캐닝 (Kor-Unsmile Fast-Inference)]

├── Score < 0.3  ──> \[정상 승인: 점수 패널티 없음]

└── Score >= 0.3 ──> \[Step 2 진입]

│

▼

\[Step 2: LLM 문맥 정밀 진단 및 순화 제안 (EEVE-10.8B)]

├── 비난 대상 분리: "인물/정당 비방" vs "정책적 문제점"

└── 제안 생성: 핵심 비판 근거는 유지하되 표준적 공론장 어휘로 변환

│

▼

\[Step 3: 클라이언트 인라인 인터스티셜 표출]

├── \[원클릭 순화문 적용] (평판 점수 100% 보존)

└── \[원문 그대로 등록] (평판 점수 차감 및 상단 노출 디랭킹)

