# CivicAgora 시스템 아키텍처 및 개발 문서 색인

CivicAgora는 블록체인 기반의 무신뢰 데이터 불변성과 LLM 기반 실시간 톤 코칭, 집단지성 합의 알고리즘을 결합한 오픈 거버넌스 공론장 플랫폼입니다.

---

## 1. 문서 체계
1. [`01_SYSTEM_ARCHITECTURE.md`](./01_SYSTEM_ARCHITECTURE.md): 시스템 네트워크 토폴로지, 데이터 파이프라인, 온/오프체인 데이터 스키마.
2. [`02_ALGORITHM_AND_AI.md`](./02_ALGORITHM_AND_AI.md): 브리징 지수(Bridging Index) 수학적 모델, Pol.is 클러스터링, AI 톤 코칭 파이프라인.
3. [`03_SERVICE_SPEC_AND_API.md`](./03_SERVICE_SPEC_AND_API.md): 프론트엔드 UI/UX 인터랙션, 평판 지수 스펙, 대정부 AI 브리프 포맷, 오픈 데이터 API.

---

## 2. 4단계 개발 로드맵
* **Phase 1: 신원 인증 & 데이터 레이어 (Week 1~4)**
  * ZK-Email 검증 서킷(Circom) 구현 및 검증 스마트 컨트랙트 배포.
  * ComposeDB 데이터 모델 정의 및 Helia IPFS 노드 클러스터 구축.
* **Phase 2: 합의 및 톤 코칭 엔진 (Week 5~8)**
  * Community Notes Matrix Factorization 모듈 Python/Wasm 포팅.
  * Kor-Unsmile 및 EEVE-Korean 기반 실시간 작문 코칭 백엔드 서빙(FastAPI + vLLM).
* **Phase 3: 프론트엔드 UI 및 P2P 연동 (Week 9~12)**
  * Next.js 15 (App Router) + Tailwind CSS 기반 3분할 토론 뷰 개발.
  * libp2p GossipSub 기반 실시간 블록/데이터 동기화 연동.
* **Phase 4: 대정부 파이프라인 및 오픈 API 배포 (Week 13~16)**
  * AI 합의 브리프 자동 생성기 및 국회/정부 표준 양식 내보내기 구현.
  * 연구자용 익명 집계 데이터 DuckDB/Parquet 오픈 API 릴리즈.