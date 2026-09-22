//! 머클 트리와 앵커링 증명 (VS-F6)
//!
//! 서명(VS-A4)은 **고친 글**을 드러냅니다. 지운 글은 드러내지 못합니다 —
//! 대조할 대상이 사라지기 때문입니다. 앵커링이 그 자리를 메웁니다.
//!
//! 일정 시간마다 그 기간의 모든 글을 머클 트리로 묶어 **루트 하나**를 외부의
//! 바꿀 수 없는 기록에 남깁니다. 나중에 운영자가 글을 지우면, 그 글을 가진
//! 누구나 증명을 들고 와 "이 글이 그때 루트에 들어 있었다"를 보일 수
//! 있습니다.
//!
//! 글 하나하나를 외부에 올리는 것이 아닙니다. 수천 건을 해시 하나로 묶어
//! 그것만 올립니다. 그래서 싸고, 글이 늘어도 비용이 거의 늘지 않습니다.
//!
//! ## 형식
//!
//! RFC 6962(인증서 투명성)의 방식을 따릅니다.
//!
//! ```text
//! 잎    = SHA-256(0x00 ‖ 정규 바이트)
//! 내부   = SHA-256(0x01 ‖ 왼쪽 ‖ 오른쪽)
//! ```
//!
//! 잎과 내부 노드에 다른 접두사를 두는 이유는 **둘을 섞을 수 없게** 하기
//! 위해서입니다. 접두사가 없으면 내부 노드 하나를 잎인 척 제시해 가짜 증명을
//! 만들 수 있습니다(제2원상 공격).
//!
//! 홀수로 남는 노드는 **그대로 올립니다.** 비트코인처럼 마지막 노드를 복제하면
//! 서로 다른 잎 목록이 같은 루트를 만들 수 있습니다(CVE-2012-2459). 복제는
//! 공짜처럼 보이지만 트리가 무엇을 증명하는지를 흐립니다.
//!
//! ## 잎에 무엇이 들어가는가
//!
//! 서명과 **같은 정규 바이트**입니다(`signing.rs`). 두 가지가 다른 것을
//! 가리키면 "서명은 맞는데 앵커에는 다른 것이 들어 있다"는 상태가 생기고,
//! 그것을 설명할 방법이 없습니다.
//!
//! 서명은 **누가 썼는지**를, 앵커는 **언제 존재했는지**를 말합니다. 두 성질은
//! 서로를 대신하지 못합니다.

use sha2::{Digest, Sha256};

use crate::card::{CardError, DebateCard};
use crate::policy::Policy;
use crate::signing::{opinion_payload, policy_payload};

const LEAF_PREFIX: u8 = 0x00;
const NODE_PREFIX: u8 = 0x01;

/// 증명의 한 걸음.
///
/// 형제 노드가 왼쪽인지 오른쪽인지를 함께 담습니다. 순서를 잃으면 해시를
/// 어느 쪽으로 붙일지 알 수 없고, 그러면 증명이 성립하지 않습니다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MerkleStep {
    pub hash: Vec<u8>,
    pub sibling_is_left: bool,
}

fn leaf_hash(payload: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update([LEAF_PREFIX]);
    hasher.update(payload);
    hasher.finalize().to_vec()
}

fn node_hash(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update([NODE_PREFIX]);
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().to_vec()
}

/// 주제의 잎 해시.
pub fn policy_leaf(policy: Policy) -> Vec<u8> {
    leaf_hash(&policy_payload(&policy))
}

/// 의견의 잎 해시.
pub fn opinion_leaf(card: DebateCard) -> Vec<u8> {
    leaf_hash(&opinion_payload(&card))
}

fn check(leaves: &[Vec<u8>]) -> Result<(), CardError> {
    if leaves.is_empty() {
        // 빈 트리에 루트를 정의하지 않습니다. 관례상 0을 쓰기도 하지만,
        // 그러면 "아무것도 없었다"와 "0이 들어 있었다"를 구분할 수 없습니다.
        return Err(CardError::Storage {
            reason: "잎이 없습니다".into(),
        });
    }
    if let Some(bad) = leaves.iter().find(|l| l.len() != 32) {
        return Err(CardError::Storage {
            reason: format!("잎은 32바이트여야 합니다 (받은 길이 {})", bad.len()),
        });
    }
    Ok(())
}

/// 루트를 계산합니다.
///
/// **정렬하지 않습니다.** 잎의 순서 자체가 증명의 일부이므로, 여기서 정렬하면
/// 서버가 쓴 순서와 달라져 증명이 맞지 않게 됩니다. 순서는 부르는 쪽이
/// 정합니다(서버는 작성 시각 오름차순, 같으면 식별자순).
pub fn merkle_root(leaves: Vec<Vec<u8>>) -> Result<Vec<u8>, CardError> {
    check(&leaves)?;

    let mut level = leaves;
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut pairs = level.chunks_exact(2);
        for pair in &mut pairs {
            next.push(node_hash(&pair[0], &pair[1]));
        }
        // 홀수로 남은 하나는 그대로 올립니다.
        if let [odd] = pairs.remainder() {
            next.push(odd.clone());
        }
        level = next;
    }
    Ok(level.into_iter().next().expect("빈 목록은 위에서 걸렀다"))
}

/// `index` 번째 잎의 증명을 만듭니다.
pub fn merkle_proof(leaves: Vec<Vec<u8>>, index: u32) -> Result<Vec<MerkleStep>, CardError> {
    check(&leaves)?;
    let mut position = index as usize;
    if position >= leaves.len() {
        return Err(CardError::Storage {
            reason: format!("{position}번 잎이 없습니다 (전체 {})", leaves.len()),
        });
    }

    let mut proof = Vec::new();
    let mut level = leaves;
    while level.len() > 1 {
        let sibling = if position % 2 == 0 {
            position + 1
        } else {
            position - 1
        };
        // 형제가 없으면(홀수로 남은 마지막) 이 층에서는 기록할 것이 없습니다.
        // 그 노드는 그대로 위로 올라가기 때문입니다.
        if sibling < level.len() {
            proof.push(MerkleStep {
                hash: level[sibling].clone(),
                sibling_is_left: sibling < position,
            });
        }

        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut pairs = level.chunks_exact(2);
        for pair in &mut pairs {
            next.push(node_hash(&pair[0], &pair[1]));
        }
        if let [odd] = pairs.remainder() {
            next.push(odd.clone());
        }
        level = next;
        position /= 2;
    }
    Ok(proof)
}

/// 잎과 증명으로 루트를 다시 만듭니다.
///
/// 결과를 앵커에 기록된 루트와 대조하는 것은 부르는 쪽의 몫입니다. 여기서
/// 비교까지 하면 "무엇과 비교했는지"가 숨고, 그러면 검증이 아니라 주장이
/// 됩니다.
pub fn merkle_apply(leaf: Vec<u8>, proof: Vec<MerkleStep>) -> Vec<u8> {
    let mut current = leaf;
    for step in proof {
        current = if step.sibling_is_left {
            node_hash(&step.hash, &current)
        } else {
            node_hash(&current, &step.hash)
        };
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaves(n: usize) -> Vec<Vec<u8>> {
        (0..n).map(|i| leaf_hash(&[i as u8])).collect()
    }

    #[test]
    fn 잎_하나면_그것이_루트다() {
        let one = leaves(1);
        assert_eq!(merkle_root(one.clone()).unwrap(), one[0]);
    }

    #[test]
    fn 빈_목록은_루트가_없다() {
        assert!(merkle_root(vec![]).is_err());
    }

    #[test]
    fn 길이가_다른_잎을_거부한다() {
        assert!(merkle_root(vec![vec![0u8; 31]]).is_err());
    }

    #[test]
    fn 모든_잎의_증명이_루트로_이어진다() {
        // 홀수·짝수, 2의 거듭제곱과 그렇지 않은 경우를 모두 본다.
        for count in 1..=17 {
            let all = leaves(count);
            let root = merkle_root(all.clone()).unwrap();
            for index in 0..count {
                let proof = merkle_proof(all.clone(), index as u32).unwrap();
                assert_eq!(
                    merkle_apply(all[index].clone(), proof),
                    root,
                    "잎 {count}개 중 {index}번"
                );
            }
        }
    }

    #[test]
    fn 잎_하나만_바뀌어도_루트가_달라진다() {
        let mut all = leaves(8);
        let before = merkle_root(all.clone()).unwrap();
        all[3] = leaf_hash("바뀐 내용".as_bytes());
        assert_ne!(merkle_root(all).unwrap(), before);
    }

    #[test]
    fn 순서가_바뀌면_루트가_달라진다() {
        // 순서를 증명의 일부로 삼았으므로 순서 변경이 드러나야 한다.
        let all = leaves(4);
        let mut swapped = all.clone();
        swapped.swap(0, 1);
        assert_ne!(merkle_root(all).unwrap(), merkle_root(swapped).unwrap());
    }

    #[test]
    fn 잎을_하나_지우면_루트가_달라진다() {
        // 이것이 앵커링의 목적이다 — 지운 글이 드러나야 한다.
        let all = leaves(5);
        let mut removed = all.clone();
        removed.remove(2);
        assert_ne!(merkle_root(all).unwrap(), merkle_root(removed).unwrap());
    }

    #[test]
    fn 마지막_잎을_복제해도_같은_루트가_되지_않는다() {
        // 비트코인식 복제 방식이었다면 3개와 "3개+마지막 복제"가 같은 루트를
        // 낸다(CVE-2012-2459). 우리 방식은 그렇지 않아야 한다.
        let three = leaves(3);
        let mut four = three.clone();
        four.push(three[2].clone());
        assert_ne!(merkle_root(three).unwrap(), merkle_root(four).unwrap());
    }

    #[test]
    fn 내부_노드를_잎으로_속일_수_없다() {
        // 접두사가 없으면 내부 노드를 잎인 척 제시해 가짜 증명을 만들 수 있다.
        let a = leaf_hash("a".as_bytes());
        let b = leaf_hash("b".as_bytes());
        let internal = node_hash(&a, &b);
        assert_ne!(internal, leaf_hash(&[a.clone(), b].concat()));
    }

    #[test]
    fn 없는_잎_번호는_오류다() {
        assert!(merkle_proof(leaves(4), 4).is_err());
    }

    #[test]
    fn 증명이_틀리면_다른_루트가_나온다() {
        let all = leaves(4);
        let root = merkle_root(all.clone()).unwrap();
        let mut proof = merkle_proof(all.clone(), 0).unwrap();
        // 형제의 좌우를 뒤집는다.
        proof[0].sibling_is_left = !proof[0].sibling_is_left;
        assert_ne!(merkle_apply(all[0].clone(), proof), root);
    }
}

#[cfg(test)]
mod vectors {
    use super::*;
    use serde::Deserialize;
    use std::collections::BTreeMap;

    /// 공용 시험 벡터.
    ///
    /// 이 형식은 서버(TypeScript)가 한 번 더 구현한다. 두 구현이 갈리면
    /// 서버가 만든 증명이 앱에서 통과하지 않는데, 그 원인은 **접두사 한
    /// 바이트**인 경우가 많아 로그만 봐서는 찾기 어렵다.
    const VECTORS: &str = include_str!("../../contracts/anchor-vectors.json");

    #[derive(Deserialize)]
    struct Doc {
        leaf: Leaf,
        roots: BTreeMap<String, String>,
        proof: ProofCase,
    }

    #[derive(Deserialize)]
    struct Leaf {
        input_utf8: String,
        hash: String,
    }

    #[derive(Deserialize)]
    struct ProofCase {
        leaf_count: usize,
        index: u32,
        steps: Vec<Step>,
    }

    #[derive(Deserialize)]
    struct Step {
        hash: String,
        sibling_is_left: bool,
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn leaves(n: usize) -> Vec<Vec<u8>> {
        (0..n).map(|i| leaf_hash(&[i as u8])).collect()
    }

    #[test]
    fn 공용_벡터와_같은_루트를_만든다() {
        let doc: Doc = serde_json::from_str(VECTORS).expect("벡터 파일");

        assert_eq!(
            hex(&leaf_hash(doc.leaf.input_utf8.as_bytes())),
            doc.leaf.hash
        );
        assert!(!doc.roots.is_empty(), "벡터가 비어 있다");

        for (count, expected) in &doc.roots {
            let n: usize = count.parse().expect("잎 개수");
            assert_eq!(&hex(&merkle_root(leaves(n)).unwrap()), expected, "잎 {n}개");
        }

        let proof = merkle_proof(leaves(doc.proof.leaf_count), doc.proof.index).unwrap();
        assert_eq!(proof.len(), doc.proof.steps.len(), "증명 길이");
        for (step, expected) in proof.iter().zip(&doc.proof.steps) {
            assert_eq!(hex(&step.hash), expected.hash);
            assert_eq!(step.sibling_is_left, expected.sibling_is_left);
        }
    }
}
