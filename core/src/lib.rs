//! CivicAgora 공유 코어
//!
//! Windows(WinUI 3)와 Android(Jetpack Compose) 앱이 공유하는 비 UI 로직.
//! UI를 제외한 모든 것 — 키·DID, ZK 증명, P2P, 로컬 저장, 온디바이스
//! 유해성 스크리닝 — 이 크레이트에 있다.
//!
//! 두 플랫폼이 로직을 각자 구현하면 서명 방식이나 합의 규칙이 미세하게
//! 어긋나 네트워크가 갈라진다. 그 버그는 재현조차 어렵다.
//!
//! 명세: `docs/05_CLIENT_APPS.md`
//! 작업 단위: `docs/09_DEVELOPMENT_PLAN.md`

// uniffi가 생성한 스캐폴딩에 이 lint에 걸리는 코드가 있다. 생성 코드라
// 고칠 수 없으므로 크레이트 범위에서만 허용한다. 우리가 쓴 코드에는
// 적용하지 않도록 다른 lint는 그대로 둔다.
#![allow(clippy::empty_line_after_doc_comments)]

uniffi::include_scaffolding!("civicagora");

mod api;
mod card;
mod identity;
mod info;
mod merkle;
mod policy;
mod signing;
mod store;

pub use api::{add_opinion_body, open_policy_body, parse_id, parse_opinions, parse_policies};
pub use card::{grapheme_count, CardError, DebateCard, DraftCard, StanceType};
pub use identity::{did_from_public_key, public_key_from_did, verify_signature, IdentityError};
pub use info::{core_info, CoreInfo, SPEC_REVISION};
pub use merkle::{merkle_apply, merkle_proof, merkle_root, opinion_leaf, policy_leaf, MerkleStep};
pub use policy::{DraftPolicy, Policy, PolicyCategory, PolicySummary};
pub use signing::{
    check_opinion, check_policy, opinion_signing_payload, policy_id, policy_signing_payload,
    SignatureStatus,
};
pub use store::CardStore;
