"""정책 함수 검증.

모델 호출 없이 전부 돌아간다. 정책이 순수 함수이기 때문이며, 같은 성질
덕분에 제3자도 기록된 판단값으로 결정을 재계산할 수 있다.
"""

from civicagora_moderation import (
    Decision,
    EvidenceVerdict,
    Judgments,
    Policy,
    audit_record,
    decide,
    evidence_verdict,
)


def j(**kwargs) -> Judgments:
    base = dict(
        is_personal_attack=0.05,
        attack_target="policy_substance",
        norm_severity=0.2,
        solution_is_actionable=0.9,
    )
    base.update(kwargs)
    return Judgments(**base)


class Test톤코칭결정:
    def test_정중한_정책비판은_통과한다(self):
        assert decide(j()) is Decision.PASS

    def test_강한_어조라도_정책을_향하면_경고하지_않는다(self):
        # 이 플랫폼의 목적은 날선 정책 비판을 막는 것이 아니다.
        # 대상이 정책이면 인신공격 확률이 높게 나와도 배너를 띄우지 않는다.
        verdict = decide(j(is_personal_attack=0.80, attack_target="policy_substance"))
        assert verdict is Decision.RECORD_ONLY

    def test_인물을_향한_공격은_배너를_띄운다(self):
        assert decide(j(is_personal_attack=0.81, attack_target="person_or_party")) is Decision.COACH

    def test_혐오표현은_대상과_무관하게_배너를_띄운다(self):
        # 규범 위반 점수가 임계를 넘으면 대상 판단을 기다리지 않는다.
        assert decide(j(norm_severity=2.3, attack_target="policy_substance")) is Decision.COACH

    def test_회색지대는_경고하지_않고_기록만_한다(self):
        assert decide(j(is_personal_attack=0.40)) is Decision.RECORD_ONLY

    def test_임계치_경계값은_포함한다(self):
        p = Policy()
        assert decide(j(is_personal_attack=p.attack_review)) is Decision.RECORD_ONLY
        assert decide(
            j(is_personal_attack=p.attack_action, attack_target="both")
        ) is Decision.COACH
        assert decide(j(norm_severity=p.severity_block)) is Decision.COACH

    def test_정책을_바꾸면_재추론_없이_결정이_바뀐다(self):
        # 판단값을 그대로 두고 임계치만 조정해도 결정이 달라진다.
        # 임계치 튜닝에 재추론이 필요 없다는 성질을 고정한다.
        judgments = j(is_personal_attack=0.50, attack_target="person_or_party")
        assert decide(judgments, Policy()) is Decision.RECORD_ONLY
        assert decide(judgments, Policy(attack_action=0.45)) is Decision.COACH


class Test근거판정:
    def test_근거를_못_가져오면_미검증이다(self):
        assert evidence_verdict(j()) is EvidenceVerdict.UNVERIFIED

    def test_뒷받침하면_통과한다(self):
        v = evidence_verdict(j(evidence_relation="supports", evidence_confidence=0.9))
        assert v is EvidenceVerdict.SUPPORTED

    def test_확신도가_낮으면_자동판정하지_않는다(self):
        # 허위 출처 제재는 -40점이다. 확신 없이 자동 적용하지 않는다.
        v = evidence_verdict(j(evidence_relation="contradicts", evidence_confidence=0.6))
        assert v is EvidenceVerdict.NEEDS_REVIEW

    def test_반대_근거는_높은_확신도에서만_확정한다(self):
        v = evidence_verdict(j(evidence_relation="contradicts", evidence_confidence=0.95))
        assert v is EvidenceVerdict.CONTRADICTED


class Test감사로그:
    def test_판단값과_정책을_함께_기록한다(self):
        # 이 둘이 없으면 제3자가 편향을 검증할 수 없다.
        judgments = j(
            is_personal_attack=0.81,
            attack_target="person_or_party",
            raw={"is_personal_attack": {"noul": 0.81}},
        )
        record = audit_record(
            target="ceramic://k2t6wz",
            decision=decide(judgments),
            judgments=judgments,
            policy=Policy(),
            model="jev-1.13.0",
            decided_at="2026-09-21T11:00:00+09:00",
        )
        assert record["action"] == "COACH"
        assert record["judgments"] == {"is_personal_attack": {"noul": 0.81}}
        assert record["policy"]["attack_action"] == 0.70
        assert record["model"] == "jev-1.13.0"

    def test_기록된_값으로_결정을_재계산할_수_있다(self):
        # 감사 가능성의 핵심. 로그만 있으면 결정을 되짚을 수 있어야 한다.
        judgments = j(is_personal_attack=0.81, attack_target="person_or_party")
        record = audit_record(
            target="t", decision=decide(judgments), judgments=judgments,
            policy=Policy(), model="m", decided_at="t",
        )
        replayed = decide(judgments, Policy(**record["policy"]))
        assert replayed.value == record["action"]
