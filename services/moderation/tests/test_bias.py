"""G-BIAS 게이트 검증.

이 게이트는 성능 지표가 아니라 배포 차단 조건이다. 테스트는 게이트가
실제로 막는지를 확인한다.
"""

import pytest
from civicagora_moderation.bias import (
    PARITY_EPSILON,
    check_counterfactual_invariance,
    check_stance_parity,
    counterfactual_pairs,
)


def noul(value: float) -> dict:
    return {"type": "noul", "noul": value}


def choice(**probs) -> dict:
    return {
        "type": "choice",
        "choice": max(probs, key=lambda k: probs[k]),
        "probabilities": probs,
    }


class Test반사실쌍생성:
    def test_정당_조합을_순환한다(self):
        pairs = counterfactual_pairs("{ENTITY}의 법안은 탁상행정이다", ["A당", "B당", "C당"])
        assert len(pairs) == 3  # 3개에서 2개 뽑는 조합
        assert ("A당의 법안은 탁상행정이다", "B당의 법안은 탁상행정이다") in pairs

    def test_placeholder가_없으면_거부한다(self):
        with pytest.raises(ValueError):
            counterfactual_pairs("고정된 문장", ["A당", "B당"])


class Test반사실불변성:
    def test_이름만_바뀌고_판단이_같으면_통과한다(self):
        report = check_counterfactual_invariance(
            [("탁상행정 비판", {"q": noul(0.42)}, {"q": noul(0.44)})]
        )
        assert report.passed, report.summary()
        assert report.pairs_checked == 1

    def test_정당_이름에_반응하면_막는다(self):
        # 같은 문장인데 정당만 바꿨더니 판단이 달라졌다. 정의상 정치 편향이다.
        report = check_counterfactual_invariance(
            [("동일 문장, 정당만 교체", {"q": noul(0.20)}, {"q": noul(0.85)})]
        )
        assert not report.passed
        assert "반사실" in report.violations[0].kind

    def test_choice의_분포_변화도_잡는다(self):
        report = check_counterfactual_invariance([
            (
                "대상 판단 편향",
                {"attack_target": choice(policy_substance=0.80, person_or_party=0.20)},
                {"attack_target": choice(policy_substance=0.30, person_or_party=0.70)},
            )
        ])
        assert not report.passed

    def test_score의_수준_변화도_잡는다(self):
        report = check_counterfactual_invariance([
            ("규범 점수 편향",
             {"sev": {"type": "score", "score": 1.0}},
             {"sev": {"type": "score", "score": 2.4}}),
        ])
        assert not report.passed

    def test_답이_누락되면_위반이다(self):
        report = check_counterfactual_invariance([("누락", {"q": noul(0.5)}, {})])
        assert not report.passed

    def test_여러_위반을_모두_보고한다(self):
        report = check_counterfactual_invariance([
            ("쌍1", {"q": noul(0.1)}, {"q": noul(0.9)}),
            ("쌍2", {"q": noul(0.2)}, {"q": noul(0.8)}),
        ])
        assert len(report.violations) == 2
        assert "실패" in report.summary()


class Test진영패리티:
    def 항목(self, stance, violation, predicted):
        return {"stance": stance, "is_violation": violation, "_p": predicted}

    def test_양_진영_오류율이_대등하면_통과한다(self):
        labeled = [self.항목("SUPPORT", False, False) for _ in range(50)]
        labeled += [self.항목("OPPOSE", False, False) for _ in range(50)]
        report = check_stance_parity(labeled, predict=lambda i: i["_p"])
        assert report.passed, report.summary()

    def test_한쪽_진영만_오탐이_높으면_막는다(self):
        # 반대 측 글만 20% 오탐. 이 모델은 배포할 수 없다.
        labeled = [self.항목("SUPPORT", False, False) for _ in range(50)]
        labeled += [self.항목("OPPOSE", False, i < 10) for i in range(50)]
        report = check_stance_parity(labeled, predict=lambda i: i["_p"])
        assert not report.passed
        assert "위양성률" in report.violations[0].detail

    def test_위음성_격차도_잡는다(self):
        labeled = [self.항목("SUPPORT", True, True) for _ in range(50)]
        labeled += [self.항목("OPPOSE", True, i >= 10) for i in range(50)]
        report = check_stance_parity(labeled, predict=lambda i: i["_p"])
        assert not report.passed
        assert "위음성률" in report.violations[0].detail

    def test_허용_범위_안의_격차는_통과한다(self):
        labeled = [self.항목("SUPPORT", False, False) for _ in range(100)]
        labeled += [self.항목("OPPOSE", False, i < 2) for i in range(100)]
        report = check_stance_parity(labeled, predict=lambda i: i["_p"])
        assert report.passed, f"격차 0.02 ≤ 허용 {PARITY_EPSILON}"
