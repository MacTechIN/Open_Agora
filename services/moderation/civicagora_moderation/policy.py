"""판단값에 정책을 적용해 결정을 내린다.

순수 함수다. 모델을 부르지 않고 부수효과가 없으므로, 기록된 판단값만 있으면
제3자가 같은 결정을 재계산해 검증할 수 있다. 이것이 공개 중재 로그의 감사
가능성을 떠받친다.

명세: docs/10_AI_JUDGMENTS.md §3.2, §5
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Decision(str, Enum):
    """톤 코칭 결정."""

    PASS = "PASS"
    """경고 없이 통과. 기록도 남기지 않는다."""

    RECORD_ONLY = "RECORD_ONLY"
    """회색지대. 사용자에게 경고하지 않되 판단값은 기록한다.

    무해한 강한 어조까지 경고하면 코치가 잔소리로 전락해 사용자가 이탈한다.
    """

    COACH = "COACH"
    """인라인 배너를 띄우고 순화문을 제안한다. 사용자는 강행 게시를 선택할 수 있다."""


class EvidenceVerdict(str, Enum):
    """근거 URL 판정."""

    SUPPORTED = "SUPPORTED"
    UNVERIFIED = "UNVERIFIED"
    """화이트리스트 밖이거나 주장을 다루지 않는다. '미검증 출처' 배지."""

    CONTRADICTED = "CONTRADICTED"
    """근거가 주장과 반대다. 허위 출처 제재 후보이므로 사람 검토로 보낸다."""

    NEEDS_REVIEW = "NEEDS_REVIEW"
    """판단 확신도가 낮다. 자동 판정하지 않는다."""


@dataclass(frozen=True)
class Policy:
    """임계치 묶음.

    기본값은 TypeSafe 문서의 가드레일 예시에서 출발한 것이며 우리 데이터에서
    검증된 값이 아니다. docs/10_AI_JUDGMENTS.md §7의 평가를 마치기 전에는
    잠정값으로 다룬다.
    """

    attack_review: float = 0.35
    """이 값 이상이면 회색지대로 기록한다."""

    attack_action: float = 0.70
    """이 값 이상이고 대상이 인물·정당이면 배너를 띄운다."""

    severity_block: float = 2.0
    """규범 위반 점수가 이 값 이상이면 대상과 무관하게 배너를 띄운다."""

    evidence_confidence: float = 0.80
    """인용 판정을 자동 적용할 최소 확신도. 미만은 사람 검토."""


@dataclass(frozen=True)
class Judgments:
    """모델이 돌려준 원시 판단값.

    가공하지 않고 그대로 보관한다. 임계치가 바뀌어도 재추론할 필요가 없고,
    진영별 편향을 사후에 통계적으로 검증할 수 있다.
    """

    is_personal_attack: float
    attack_target: str
    norm_severity: float
    solution_is_actionable: float
    attack_target_confidence: float = 0.0
    norm_severity_confidence: float = 0.0
    evidence_relation: str | None = None
    evidence_confidence: float = 0.0
    raw: dict[str, Any] = field(default_factory=dict)
    """API 원본 응답. 감사 로그에 그대로 싣는다."""


#: 비판이 사람을 향한다고 보는 대상 값.
_PERSON_TARGETS = frozenset({"person_or_party", "both"})


def decide(j: Judgments, policy: Policy | None = None) -> Decision:
    """톤 코칭 결정을 내린다.

    인물 공격은 '표현의 강도'가 아니라 '대상의 성격' 문제이므로, 강도 점수
    단독이 아니라 대상 판단과 결합해 본다. 정책을 날카롭게 비판하는 글이
    강한 어조라는 이유로 경고받아서는 안 된다.
    """
    policy = policy or Policy()

    attacks_person = (
        j.is_personal_attack >= policy.attack_action
        and j.attack_target in _PERSON_TARGETS
    )
    if attacks_person or j.norm_severity >= policy.severity_block:
        return Decision.COACH

    if j.is_personal_attack >= policy.attack_review:
        return Decision.RECORD_ONLY

    return Decision.PASS


def evidence_verdict(j: Judgments, policy: Policy | None = None) -> EvidenceVerdict:
    """근거 URL 판정.

    'contradicts'는 허위 출처 제재(-40점)로 이어질 수 있으므로 높은 확신도에서만
    적용하고, 그 밖에는 사람 검토로 보낸다. 자동 제재의 오판은 되돌리기 어렵다.
    """
    policy = policy or Policy()

    if j.evidence_relation is None:
        return EvidenceVerdict.UNVERIFIED

    if j.evidence_confidence < policy.evidence_confidence:
        return EvidenceVerdict.NEEDS_REVIEW

    return {
        "supports": EvidenceVerdict.SUPPORTED,
        "contradicts": EvidenceVerdict.CONTRADICTED,
        "unrelated": EvidenceVerdict.UNVERIFIED,
    }[j.evidence_relation]


def audit_record(
    *,
    target: str,
    decision: Decision,
    judgments: Judgments,
    policy: Policy,
    model: str,
    decided_at: str,
) -> dict[str, Any]:
    """공개 중재 로그 항목을 만든다.

    판단값과 정책을 함께 싣는 것이 핵심이다. 이 둘이 있어야 제3자가
    (1) 정책 적용의 일관성을 재계산하고, (2) 진영별 편향을 통계적으로 검증하고,
    (3) 임계치가 조용히 바뀌었는지 확인할 수 있다.

    명세: docs/04_REPUTATION_MODERATION.md §3.2, docs/10_AI_JUDGMENTS.md §5
    """
    return {
        "target": target,
        "action": decision.value,
        "judgments": judgments.raw,
        "policy": {
            "attack_review": policy.attack_review,
            "attack_action": policy.attack_action,
            "severity_block": policy.severity_block,
        },
        "model": model,
        "decided_at": decided_at,
    }
