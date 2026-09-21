# CivicAgora: 탈중앙화 정책 공론장 기술 연구 보고서 (Research \& Benchmark)

본 문서는 CivicAgora 플랫폼 구축에 필요한 핵심 컴포넌트를 GitHub 오픈소스 및 Hugging Face 모델 생태계에서 검토·선정한 기술 스택 분석 보고서입니다.

\---

## 1\. 프라이버시 \& 무신뢰 본인인증 (ZK-Email \& DID)

실제 이메일 주소와 실명을 외부에 공개하지 않으면서 1인 1계정 유권자 본인 인증을 수학적으로 검증합니다.

* **zk-email / email-wallet (GitHub: `zkemail/zk-email-verify`)**

  * **원리:** 메일 제공업체(Google, Naver 등)가 서명한 DKIM(DomainKeys Identified Mail) 암호 서명을 영지식 증명(Groth16/SnarkJS) 회로로 검증.
  * **특징:** 서버나 블록체인에 이메일 원문, 주소, 실명을 일절 남기지 않고, 오직 "유효한 이메일 보유자"라는 Proof와 고유 Nullifier Hash만 온체인에 기록하여 다중 계정 생성을 방지.
* **DID \& Verifiable Credentials (GitHub: `spruceid/ssi`)**

  * 분산 신원증명(DID) 표준을 채택해 사용자의 기기 로컬 키페어(Secp256k1/Ed25519)와 인증 상태를 매핑.

\---

## 2\. 브리징 알고리즘 \& 집단지성 엔진

양극화된 진영 간 상호 비방을 방지하고 양측 모두가 수긍하는 합리적 대안을 상위권으로 도출합니다.

* **Twitter Community Notes 알고리즘 (GitHub: `twitter/communitynotes`)**

  * **핵심 수식:** Matrix Factorization 기반의 행렬 분해 알고리즘.
  * **기능:** 투표자의 정치적 성향 편향값(Intercept)을 산출하고, 대립하는 진영의 사용자들이 동시에 긍정 평가한 제안에만 가중치(Bridging Factor)를 부여. 단순 화력 지원이나 좌표 찍기 무력화.
* **Pol.is Consensus Engine (GitHub: `pol-is/polisServer`)**

  * **특징:** 대만 거버넌스 플랫폼 'vTaiwan'에서 검증된 오픈소스 엔진.
  * **알고리즘:** 실시간 주성분 분석(PCA) 및 K-Means 클러스터링을 통해 참여자들을 의견 그룹별로 실시간 군집화하고, 군집 간 교차 합의율(Consensus Threshold)을 계산.

\---

## 3\. 실시간 한국어 AI 톤 코칭 \& 중재 모델

단순 단속·차단이 아닌, 작성 단계에서 자발적 순화를 유도하는 AI 파이프라인입니다.

* **한국어 악성 댓글 탐지:** `smilegate-ai/kor\_unsmile` (Hugging Face)

  * 비난, 혐오, 인신공격, 조롱, 차별 등 10개 카테고리의 텍스트 독성을 실시간 분류(Score 0.0\~1.0).
* **문맥 언어 모델:** `beomi/KcELECTRA-base-v2022` (Hugging Face)

  * 정치 커뮤니티의 신조어, 은어, 초성 비하 표현을 정밀하게 탐지.
* **실시간 순화 및 브리프 생성 모델:** `yanolja/EEVE-Korean-Instruct-10.8B` 또는 `Qwen/Qwen2.5-7B-Instruct`

  * 감정적·공격적 문장이 감지되었을 때, 핵심 논지는 유지하면서 정중한 공론장 어조로 즉각 재작성(Paraphrase) 제안.

\---

## 4\. 탈중앙 P2P 데이터 계층

중앙 서버 독점 및 검열을 차단하고 로컬/인터넷 환경에서 자율 동기화합니다.

* **Ceramic Network \& ComposeDB (GitHub: `ceramicnetwork/js-ceramic`)**

  * 탈중앙 이벤트 스트림 기반 문서 DB. DID로 서명된 500자 정책 제안과 토론 데이터를 GraphQL 스키마로 관리.
* **IPFS \& Helia (GitHub: `ipfs/helia`)**

  * 브라우저 및 로컬 노드 환경에서 가볍게 구동되는 차세대 JS IPFS 클라이언트.
* **libp2p (GitHub: `libp2p/js-libp2p`)**

  * NAT Traversal(STUN/TURN, AutoNAT), GossipSub 프로토콜을 탑재하여 사설 공유기(AP) 하위 환경 및 퍼블릭 인터넷 간 P2P 메시지 전파 보장.

