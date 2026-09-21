"""엔진 경계 검증 — 정본 대조와 식별자 기록."""

from civicagora_moderation import (
    CANONICAL_TOLERANCE,
    EngineIdentity,
    EngineResult,
    compare_to_canonical,
    quantize,
    stable_hash,
)


def result(answers, *, reproducible=True, engine="local-scoring"):
    return EngineResult(
        answers=answers,
        identity=EngineIdentity(
            engine=engine,
            weights_cid="bafy123",
            tokenizer_hash="sha256:tok",
            prompt_template_hash="sha256:tmpl",
            option_set_hash="sha256:opts",
        ),
        reproducible=reproducible,
    )


class Test양자화:
    def test_소수_4자리로_고정한다(self):
        assert quantize(0.783412345) == 0.7834

    def test_같은_입력은_같은_값이다(self):
        assert quantize(1 / 3) == quantize(1 / 3)


class Test해시안정성:
    def test_키_순서에_흔들리지_않는다(self):
        # 흔들리면 같은 입력이 다른 해시를 낳아 재계산 검증이 무의미해진다.
        assert stable_hash({"b": 1, "a": 2}) == stable_hash({"a": 2, "b": 1})

    def test_한글이_이스케이프되지_않는다(self):
        assert stable_hash({"k": "정책"}) == stable_hash({"k": "정책"})

    def test_값이_다르면_해시가_다르다(self):
        assert stable_hash({"a": 1}) != stable_hash({"a": 2})


class Test식별자기록:
    def test_재구성에_필요한_값이_모두_담긴다(self):
        record = result({}).identity.as_record()
        for key in ("engine", "weights_cid", "tokenizer_hash",
                    "prompt_template_hash", "option_set_hash", "temperature"):
            assert key in record, key


class Test정본대조:
    def test_일치하면_차이가_없다(self):
        answers = {"q": {"type": "noul", "noul": 0.8123}}
        assert compare_to_canonical(result(answers), result(answers)) == []

    def test_허용_오차_안은_통과한다(self):
        prod = result({"q": {"type": "noul", "noul": 0.8123}})
        canon = result({"q": {"type": "noul", "noul": 0.8128}})
        assert compare_to_canonical(prod, canon, tolerance=1e-3) == []

    def test_벗어나면_잡아낸다(self):
        prod = result({"q": {"type": "noul", "noul": 0.81}})
        canon = result({"q": {"type": "noul", "noul": 0.92}})
        assert compare_to_canonical(prod, canon, tolerance=CANONICAL_TOLERANCE)

    def test_분포_불일치도_잡는다(self):
        prod = result({"q": {"type": "choice", "probabilities": {"a": 0.8, "b": 0.2}}})
        canon = result({"q": {"type": "choice", "probabilities": {"a": 0.5, "b": 0.5}}})
        assert len(compare_to_canonical(prod, canon)) == 2

    def test_운영_결과에_답이_없으면_잡는다(self):
        canon = result({"q": {"type": "noul", "noul": 0.5}})
        assert compare_to_canonical(result({}), canon)


class Test재현가능성표시:
    def test_외부_엔진은_재현_불가로_표시된다(self):
        # 재현 불가한 근거로 제재할 수 없다. 호출부가 이 플래그를 봐야 한다.
        assert result({}, reproducible=False, engine="typesafe").reproducible is False
