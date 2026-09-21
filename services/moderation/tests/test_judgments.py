"""질문·상태 구성 검증."""

import json

from civicagora_moderation import build_state, card_questions, parse_answers
from civicagora_moderation.client import ModerationUnavailable
import pytest


class Test질문구성:
    def test_근거가_없으면_인용검증을_묻지_않는다(self):
        # 발췌문 없이 물으면 모델은 답할 근거가 없고, 그 답으로 점수를 깎으면
        # 사용자가 통제할 수 없는 이유로 처벌받는다.
        assert "evidence_relation" not in card_questions(with_evidence=False)
        assert "evidence_relation" in card_questions(with_evidence=True)

    def test_모든_질문에_유형이_있다(self):
        for qid, q in card_questions(with_evidence=True).items():
            assert q["type"] in {"noul", "choice", "score"}, qid
            assert q["instructions"], qid

    def test_선택지에_해당없음이_있다(self):
        # 없으면 모델이 항상 무언가를 고르게 되어 비판이 아닌 글도 분류된다.
        assert "neither" in card_questions(with_evidence=False)["attack_target"]["criteria"]

    def test_척도는_구체적_상황을_서술한다(self):
        # "보통/심각" 같은 라벨은 판단 기준이 되지 못한다.
        for level in card_questions(with_evidence=False)["norm_severity"]["criteria"]:
            assert len(level) > 10, level

    def test_질문_묶음이_직렬화된다(self):
        json.dumps(card_questions(with_evidence=True), ensure_ascii=False)


class Test상태구성:
    def 상태(self, **kw):
        base = dict(
            policy_title="탄력 근로제 개선안",
            core_question="직종별 유연 적용을 어떤 조건에서 허용할 것인가",
            stance="OPPOSE",
            problem_definition="현행 제도는 일률 적용으로 행정 비용을 키운다",
            evidence_source="통계청 2026 사업체노동력조사",
            actionable_solution="업종별 가이드라인을 차등화한다",
        )
        base.update(kw)
        return build_state(**base)

    def test_작성자_신원을_포함하지_않는다(self):
        # INV-1. 제3자 서비스에 신원과 정치적 발언이 함께 가서는 안 된다.
        blob = json.dumps(self.상태(), ensure_ascii=False)
        for leak in ("did:", "author", "email", "nullifier", "필명"):
            assert leak not in blob.lower(), leak

    def test_근거가_없으면_evidence_키가_없다(self):
        assert "evidence" not in self.상태()

    def test_근거를_주면_발췌문이_담긴다(self):
        state = self.상태(evidence_domain="kostat.go.kr", evidence_excerpt="…본문…")
        assert state["evidence"]["domain"] == "kostat.go.kr"


class Test응답파싱:
    응답 = {
        "model": "jev-1.13.0",
        "answers": {
            "attack_target": {
                "type": "choice",
                "choice": "person_or_party",
                "probabilities": {"policy_substance": 0.11, "person_or_party": 0.78,
                                  "both": 0.09, "neither": 0.02},
                "confidence": 0.74,
            },
            "is_personal_attack": {"type": "noul", "noul": 0.81},
            "norm_severity": {"type": "score", "score": 2.3, "confidence": 0.66},
            "solution_is_actionable": {"type": "noul", "noul": 0.42},
        },
    }

    def test_판단값을_그대로_읽는다(self):
        j = parse_answers(self.응답)
        assert j.attack_target == "person_or_party"
        assert j.is_personal_attack == 0.81
        assert j.norm_severity == 2.3
        assert j.evidence_relation is None

    def test_원본_응답을_보관한다(self):
        # 감사 로그에 원본을 그대로 싣기 위해 필요하다.
        assert parse_answers(self.응답).raw == self.응답["answers"]

    def test_필드가_없으면_예외를_낸다(self):
        # 조용히 0.0으로 채우면 모든 글이 통과해 버린다.
        broken = {"answers": dict(self.응답["answers"])}
        del broken["answers"]["is_personal_attack"]
        with pytest.raises(ModerationUnavailable):
            parse_answers(broken)

    def test_형식이_다르면_예외를_낸다(self):
        with pytest.raises(ModerationUnavailable):
            parse_answers({"오류": "형식 불명"})
