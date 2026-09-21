"""CivicAgora 주권 판단 계층.

판단은 생성이 아니라 제약 채점으로 수행한다. 정책은 순수 함수로 분리하고,
원시 판단값과 정책을 함께 기록해 제3자가 결정을 재계산하고 편향을 검증할
수 있게 한다.

명세: docs/10_AI_JUDGMENTS.md, docs/11_SOVEREIGN_JUDGMENT.md
"""

from .bias import (
    BiasReport,
    Violation,
    check_counterfactual_invariance,
    check_stance_parity,
    counterfactual_pairs,
)
from .client import ModerationUnavailable, ask, parse_answers
from .engine import (
    CANONICAL_PRECISION,
    CANONICAL_TOLERANCE,
    EngineDivergence,
    EngineIdentity,
    EngineResult,
    JudgmentEngine,
    compare_to_canonical,
    quantize,
    stable_hash,
)
from .judgments import build_state, card_questions
from .policy import (
    Decision,
    EvidenceVerdict,
    Judgments,
    Policy,
    audit_record,
    decide,
    evidence_verdict,
)
from .scoring import (
    ScoringError,
    choice_answer,
    confidence_of,
    noul_answer,
    normalize_logprobs,
    score_answer,
)

__all__ = [
    "BiasReport",
    "CANONICAL_PRECISION",
    "CANONICAL_TOLERANCE",
    "Decision",
    "EngineDivergence",
    "EngineIdentity",
    "EngineResult",
    "EvidenceVerdict",
    "JudgmentEngine",
    "Judgments",
    "ModerationUnavailable",
    "Policy",
    "ScoringError",
    "Violation",
    "ask",
    "audit_record",
    "build_state",
    "card_questions",
    "check_counterfactual_invariance",
    "check_stance_parity",
    "choice_answer",
    "compare_to_canonical",
    "confidence_of",
    "counterfactual_pairs",
    "decide",
    "evidence_verdict",
    "noul_answer",
    "normalize_logprobs",
    "parse_answers",
    "quantize",
    "score_answer",
    "stable_hash",
]
