"""판단 실행자 경계.

정책·감사·게이트 계층은 이 경계 뒤를 알지 못한다. 따라서 실행자를 바꿔도
결정 규칙과 감사 형식은 그대로다.

명세: docs/11_SOVEREIGN_JUDGMENT.md §8
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, runtime_checkable

#: 정본값 소수 자릿수.
#:
#: GPU와 CPU의 미세한 부동소수점 차이가 기록값과 결정을 바꾸지 않도록,
#: 양자화된 값만 기록하고 정책에 투입한다. 이 자릿수에서 두 경로가 갈리면
#: 조용한 오차가 아니라 감지된 불일치이며 보류 처리된다.
CANONICAL_PRECISION = 4

#: 운영 경로가 정본 경로에서 벗어나도 되는 최대 폭.
CANONICAL_TOLERANCE = 1e-3


def quantize(value: float) -> float:
    """확률을 정본 자릿수로 양자화한다."""
    return round(float(value), CANONICAL_PRECISION)


def stable_hash(payload: Any) -> str:
    """입력을 안정적으로 해시한다.

    키 순서와 공백에 흔들리면 같은 입력이 다른 해시를 낳아 재계산 검증이
    무의미해진다. 정렬과 구분자를 고정한다.
    """
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class EngineIdentity:
    """판정을 재구성하는 데 필요한 모든 식별자.

    여섯 값이 모두 있어야 제3자가 동일 조건을 재구성할 수 있다. 프롬프트
    템플릿과 선택지 집합까지 해시하는 이유는, 이것이 바뀌면 같은 가중치라도
    다른 판단이 나오기 때문이다. 조용한 프롬프트 수정은 조용한 정책 변경과 같다.
    """

    engine: str
    weights_cid: str | None
    tokenizer_hash: str | None
    prompt_template_hash: str | None
    option_set_hash: str
    temperature: float = 1.0
    """§6의 온도 보정값. 1.0은 미보정."""

    def as_record(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "weights_cid": self.weights_cid,
            "tokenizer_hash": self.tokenizer_hash,
            "prompt_template_hash": self.prompt_template_hash,
            "option_set_hash": self.option_set_hash,
            "temperature": self.temperature,
        }


@dataclass(frozen=True)
class EngineResult:
    """실행자가 돌려준 결과."""

    answers: dict[str, Any]
    identity: EngineIdentity
    reproducible: bool
    """정본 경로로 재계산할 수 있는가. 거짓이면 제재 근거로 쓸 수 없다."""

    input_hash: str = ""
    warnings: list[str] = field(default_factory=list)


@runtime_checkable
class JudgmentEngine(Protocol):
    """판단 실행자."""

    name: str
    reproducible: bool

    def judge(
        self, state: Mapping[str, Any], questions: Mapping[str, Any]
    ) -> EngineResult: ...


class EngineDivergence(RuntimeError):
    """운영 경로가 정본 경로와 허용 오차를 넘어 벌어졌다.

    호출부는 이 판정을 적용하지 말고 보류 큐로 보내야 한다.
    """


def compare_to_canonical(
    production: EngineResult,
    canonical: EngineResult,
    *,
    tolerance: float = CANONICAL_TOLERANCE,
) -> list[str]:
    """운영 결과를 정본과 대조해 벗어난 항목을 돌려준다.

    1% 표본에 상시 적용한다. 빈 리스트가 아니면 알람 대상이다.
    """
    divergences: list[str] = []

    for qid, canon in canonical.answers.items():
        prod = production.answers.get(qid)
        if prod is None:
            divergences.append(f"{qid}: 운영 결과에 없음")
            continue

        for key in ("noul", "score", "confidence"):
            if key in canon and key in prod:
                if abs(float(canon[key]) - float(prod[key])) > tolerance:
                    divergences.append(
                        f"{qid}.{key}: 정본 {canon[key]} vs 운영 {prod[key]}"
                    )

        canon_probs = canon.get("probabilities") or {}
        prod_probs = prod.get("probabilities") or {}
        for option, value in canon_probs.items():
            if abs(float(value) - float(prod_probs.get(option, 0.0))) > tolerance:
                divergences.append(f"{qid}.probabilities[{option}] 불일치")

    return divergences
