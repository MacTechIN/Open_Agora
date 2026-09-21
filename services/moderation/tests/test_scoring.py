"""제약 채점 검증.

모델 없이 전부 돌아간다. 채점이 순수 수학이기 때문이며, 같은 성질 덕분에
정본 경로가 재현 가능하다.
"""

import math

import pytest
from civicagora_moderation.scoring import (
    ScoringError,
    choice_answer,
    confidence_of,
    noul_answer,
    normalize_logprobs,
    score_answer,
)


class Test분포정규화:
    def test_확률의_합이_1이다(self):
        p = normalize_logprobs({"a": -0.3, "b": -2.4, "c": -3.9})
        assert abs(sum(p.values()) - 1.0) < 1e-3

    def test_큰_로그우도가_큰_확률이다(self):
        p = normalize_logprobs({"낮음": -5.0, "높음": -0.1})
        assert p["높음"] > p["낮음"]

    def test_극단값에서_넘치지_않는다(self):
        # log-sum-exp의 최댓값 차감이 없으면 exp에서 오버플로가 난다.
        p = normalize_logprobs({"a": 900.0, "b": 899.0})
        assert abs(sum(p.values()) - 1.0) < 1e-3

    def test_토큰수로_길이를_보정한다(self):
        # 보정 없이는 토큰이 긴 선택지가 구조적으로 불리하다.
        raw = normalize_logprobs({"짧음": -2.0, "아주긴라벨": -4.0})
        adjusted = normalize_logprobs(
            {"짧음": -2.0, "아주긴라벨": -4.0}, token_counts={"짧음": 1, "아주긴라벨": 2}
        )
        assert adjusted["아주긴라벨"] > raw["아주긴라벨"]

    def test_온도가_높으면_분포가_평탄해진다(self):
        sharp = normalize_logprobs({"a": -0.1, "b": -4.0}, temperature=1.0)
        flat = normalize_logprobs({"a": -0.1, "b": -4.0}, temperature=5.0)
        assert flat["a"] < sharp["a"]

    def test_결과가_양자화된다(self):
        # 정본값은 소수 4자리다. GPU·CPU 미세 오차가 기록값을 바꾸면 안 된다.
        for value in normalize_logprobs({"a": -0.333333, "b": -1.777777}).values():
            assert value == round(value, 4)

    def test_재현된다(self):
        args = {"a": -0.3, "b": -2.4, "c": -3.9}
        assert normalize_logprobs(args) == normalize_logprobs(args)

    def test_잘못된_입력을_거부한다(self):
        with pytest.raises(ScoringError):
            normalize_logprobs({})
        with pytest.raises(ScoringError):
            normalize_logprobs({"a": -1.0}, temperature=0.0)
        with pytest.raises(ScoringError):
            normalize_logprobs({"a": -1.0}, token_counts={})


class Test확신도:
    def test_한_곳에_몰리면_높다(self):
        assert confidence_of({"a": 0.98, "b": 0.01, "c": 0.01}) > 0.8

    def test_평탄하면_0에_가깝다(self):
        assert confidence_of({"a": 1 / 3, "b": 1 / 3, "c": 1 / 3}) < 0.01

    def test_선택지_수가_달라도_비교_가능하다(self):
        # 정규화하지 않으면 선택지가 많을수록 엔트로피가 커져 비교가 무의미해진다.
        two = confidence_of({"a": 0.5, "b": 0.5})
        four = confidence_of({"a": 0.25, "b": 0.25, "c": 0.25, "d": 0.25})
        assert abs(two - four) < 0.01


class Test답생성:
    def test_choice는_최대확률을_고른다(self):
        answer = choice_answer(
            {"policy_substance": -2.41, "person_or_party": -0.34, "both": -2.88}
        )
        assert answer["choice"] == "person_or_party"
        assert answer["type"] == "choice"

    def test_choice는_선택지_밖을_내지_못한다(self):
        # 제약 채점의 핵심. 파싱 실패라는 실패 모드가 존재하지 않는다.
        options = {"a": -1.0, "b": -2.0}
        assert choice_answer(options)["choice"] in options

    def test_noul은_예의_확률이다(self):
        assert noul_answer(-0.1, -5.0)["noul"] > 0.9
        assert noul_answer(-5.0, -0.1)["noul"] < 0.1

    def test_score는_수준_사이_값을_낼_수_있다(self):
        # 두 수준 사이에서 망설이는 상태를 한쪽으로 반올림하면 정보가 사라진다.
        answer = score_answer([-9.0, -0.7, -0.7, -9.0])
        assert 1.0 < float(answer["score"]) < 2.0

    def test_score는_수준이_둘_미만이면_거부한다(self):
        with pytest.raises(ScoringError):
            score_answer([-1.0])
