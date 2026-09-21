"""톤 코칭 판단 질문 정의.

코드가 워크플로를 소유하고, 모델은 의미 판단만 맡는다. 질문은 서로의 답을
보지 못하며 한 번의 요청으로 병렬 처리된다.

명세: docs/10_AI_JUDGMENTS.md §3
"""

from __future__ import annotations

from typing import Any

# 비판의 대상. 명세가 요구하는 "인물·정당 비방 vs 정책적 문제 지적" 분리를
# 담당하는 질문이며, 기존 유해성 분류기가 할 수 없던 판단이다.
ATTACK_TARGET = {
    "type": "choice",
    "instructions": "이 글의 비판이 향하는 대상은 무엇인가?",
    "criteria": {
        "policy_substance": "정책의 내용, 설계, 예상 효과, 예산 근거를 문제 삼는다",
        "person_or_party": (
            "정책이 아니라 특정 인물·정당·지지자 집단의 자질이나 동기를 문제 삼는다"
        ),
        "both": "정책 비판과 인물·집단 공격이 함께 있다",
        "neither": "비판이라고 볼 만한 내용이 없다",
    },
}

IS_PERSONAL_ATTACK = {
    "type": "noul",
    "instructions": (
        "이 글에 특정 인물이나 정당을 인신공격하는 표현이 있는가? "
        "정책에 대한 강한 비판은 인신공격이 아니다."
    ),
}

# 수준마다 구체적 상황을 서술한다. "보통/심각" 같은 라벨은 판단 기준이 되지 못한다.
NORM_SEVERITY = {
    "type": "score",
    "instructions": "이 글이 공론장 규범을 어느 정도로 벗어나는가?",
    "criteria": [
        "정중하다. 강한 주장이지만 표현은 절제되어 있다",
        "거슬린다. 냉소나 비아냥이 있으나 논점은 유지된다",
        "모욕적이다. 상대를 깎아내리는 표현이 논점을 대체한다",
        "혐오표현이다. 집단 정체성을 근거로 비하한다",
    ],
}

# 3단 구조화 입력 Field 3 검증 규칙: "폐지하라"식 단답형 불가.
SOLUTION_IS_ACTIONABLE = {
    "type": "noul",
    "instructions": (
        "`card.actionable_solution`이 실행 가능한 대안 메커니즘을 서술하는가? "
        "'폐지하라', '철회하라' 같은 요구만 있고 방법이 없으면 아니다."
    ),
}

# 인용 검증. 링크가 붙어 있다는 사실과 링크가 주장을 뒷받침한다는 사실은 다르다.
EVIDENCE_RELATION = {
    "type": "choice",
    "instructions": (
        "`evidence.excerpt`의 내용은 `card.evidence_source`의 주장과 어떤 관계인가?"
    ),
    "criteria": {
        "supports": "발췌문이 주장의 근거가 된다",
        "contradicts": "발췌문이 주장과 반대되는 내용을 담고 있다",
        "unrelated": "발췌문이 주장을 다루지 않는다",
    },
}

#: 카드 작성 시 한 번의 요청으로 함께 던지는 질문 묶음.
CARD_QUESTIONS: dict[str, dict[str, Any]] = {
    "attack_target": ATTACK_TARGET,
    "is_personal_attack": IS_PERSONAL_ATTACK,
    "norm_severity": NORM_SEVERITY,
    "solution_is_actionable": SOLUTION_IS_ACTIONABLE,
}


def card_questions(*, with_evidence: bool) -> dict[str, dict[str, Any]]:
    """카드 판단 질문을 돌려준다.

    근거 문서를 가져오지 못했으면 인용 검증 질문을 빼야 한다. 발췌문이 없는
    상태로 물으면 모델은 답할 근거가 없고, 그 답을 점수 차감에 쓰면 사용자가
    통제할 수 없는 이유로 처벌받는다.
    """
    questions = dict(CARD_QUESTIONS)
    if with_evidence:
        questions["evidence_relation"] = EVIDENCE_RELATION
    return questions


def build_state(
    *,
    policy_title: str,
    core_question: str,
    stance: str,
    problem_definition: str,
    evidence_source: str,
    actionable_solution: str,
    evidence_domain: str | None = None,
    evidence_excerpt: str | None = None,
) -> dict[str, Any]:
    """질문에 전달할 상태를 구성한다.

    작성자 신원(DID·필명)은 포함하지 않는다. 판단에 필요하지 않고, 포함하면
    제3자 서비스에 신원과 정치적 발언이 함께 전달된다(INV-1).
    """
    state: dict[str, Any] = {
        "policy": {"title": policy_title, "core_question": core_question},
        "card": {
            "stance": stance,
            "problem_definition": problem_definition,
            "evidence_source": evidence_source,
            "actionable_solution": actionable_solution,
        },
    }
    if evidence_excerpt:
        state["evidence"] = {"domain": evidence_domain, "excerpt": evidence_excerpt}
    return state
