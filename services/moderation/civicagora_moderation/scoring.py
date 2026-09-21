"""제약 채점 — 생성 대신 선택지의 우도를 계산한다.

생성은 샘플링을 수반하고 샘플링은 시드·온도·커널에 따라 달라지므로 재현할
수 없다. 판단은 선택지가 이미 정해져 있으므로 생성이 필요 없다. 각 선택지의
로그우도를 계산해 정규화하면 순전파 한 번으로 실제 확률 분포가 나온다.

명세: docs/11_SOVEREIGN_JUDGMENT.md §3
"""

from __future__ import annotations

import math
from typing import Mapping, Sequence

from .engine import quantize


class ScoringError(ValueError):
    """채점 입력이 잘못됐다."""


def normalize_logprobs(
    logprobs: Mapping[str, float],
    *,
    token_counts: Mapping[str, int] | None = None,
    temperature: float = 1.0,
) -> dict[str, float]:
    """선택지별 로그우도를 확률 분포로 바꾼다.

    `token_counts`를 주면 토큰당 평균 로그우도로 정규화한다. 선택지 라벨의
    토큰 수가 다르면 긴 라벨이 구조적으로 불리해지므로, 길이가 고르지 않은
    선택지 집합에서는 반드시 넘겨야 한다.

    `temperature`는 보정값이다(§6). 1.0보다 크면 분포가 평탄해진다.
    """
    if not logprobs:
        raise ScoringError("선택지가 비어 있다")
    if temperature <= 0:
        raise ScoringError(f"온도는 양수여야 한다: {temperature}")

    adjusted: dict[str, float] = {}
    for option, value in logprobs.items():
        if token_counts is not None:
            count = token_counts.get(option, 0)
            if count <= 0:
                raise ScoringError(f"{option}의 토큰 수가 없다")
            value = value / count
        adjusted[option] = value / temperature

    # log-sum-exp. 최댓값을 빼지 않으면 지수 연산에서 넘친다.
    peak = max(adjusted.values())
    exponentiated = {k: math.exp(v - peak) for k, v in adjusted.items()}
    total = sum(exponentiated.values())

    return {k: quantize(v / total) for k, v in exponentiated.items()}


def confidence_of(probabilities: Mapping[str, float]) -> float:
    """분포가 얼마나 한 곳에 몰려 있는지.

    정규화 엔트로피의 여집합을 쓴다. 한 선택지에 몰리면 1.0, 완전히 평탄하면
    0.0이다. 선택지 개수가 달라도 비교할 수 있어야 하므로 정규화한다.
    """
    values = [p for p in probabilities.values() if p > 0]
    if len(values) <= 1:
        return 1.0

    entropy = -sum(p * math.log(p) for p in values)
    return quantize(1.0 - entropy / math.log(len(probabilities)))


def choice_answer(
    logprobs: Mapping[str, float],
    *,
    token_counts: Mapping[str, int] | None = None,
    temperature: float = 1.0,
) -> dict[str, object]:
    """Choice 답을 만든다."""
    probabilities = normalize_logprobs(
        logprobs, token_counts=token_counts, temperature=temperature
    )
    return {
        "type": "choice",
        "choice": max(probabilities, key=lambda k: probabilities[k]),
        "probabilities": probabilities,
        "confidence": confidence_of(probabilities),
    }


def noul_answer(
    yes_logprob: float, no_logprob: float, *, temperature: float = 1.0
) -> dict[str, object]:
    """Noul 답을 만든다. 예/아니오 두 선택지의 채점이다."""
    probabilities = normalize_logprobs(
        {"yes": yes_logprob, "no": no_logprob}, temperature=temperature
    )
    return {"type": "noul", "noul": probabilities["yes"]}


def score_answer(
    logprobs: Sequence[float], *, temperature: float = 1.0
) -> dict[str, object]:
    """Score 답을 만든다.

    점수는 수준 인덱스의 확률가중 평균이므로 수준 사이 값이 나올 수 있다.
    '모욕적'과 '혐오표현' 사이에서 망설이는 상태를 2.5로 표현하는 것이
    한쪽으로 반올림하는 것보다 많은 정보를 담는다.
    """
    if len(logprobs) < 2:
        raise ScoringError("수준이 둘 이상이어야 한다")

    keyed = {str(i): v for i, v in enumerate(logprobs)}
    probabilities = normalize_logprobs(keyed, temperature=temperature)
    expected = sum(int(i) * p for i, p in probabilities.items())

    return {
        "type": "score",
        "score": quantize(expected),
        "probabilities": probabilities,
        "confidence": confidence_of(probabilities),
    }
