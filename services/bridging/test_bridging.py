"""VS-F2 — 몰표 무력화 회귀 테스트 ★★

**이 테스트가 실패하면 이 플랫폼은 그냥 또 하나의 인기투표 사이트입니다.**

`03_ALGORITHMS_AI.md` §1.3 의 성질을 기계로 지킵니다. 랭킹·반응·평판을 건드리는
모든 변경이 이 테스트를 지나야 합니다.

## 수치가 아니라 부등호로 단언합니다

`b_i > 0.3` 같은 임계값을 쓰면 λ 나 반복 횟수를 조금만 바꿔도 깨집니다. 그러면
사람들은 성질을 지키는 대신 임계값을 고칩니다. 지켜야 하는 것은 **관계**이므로
관계로 단언하고, 파라미터를 흔들어도 관계가 유지되는지까지 봅니다.

## 긍정 표 수를 맞춥니다

몰표 카드와 브리징 카드에 **같은 수의 긍정**을 줍니다. 긍정 수로 줄 세우는
랭커는 둘을 구분하지 못하므로, 점수가 갈린다면 그것은 표의 개수가 아니라
**누가 눌렀는가**를 본다는 뜻입니다.
"""

from __future__ import annotations

import json

import pytest

import bridging as model
import synthetic

BRIGADE = "card-brigade"
BRIDGE = "card-bridge"
NOISE = "card-noise"
MEGA = "card-mega-brigade"

#: 몰표와 브리징에 같은 수의 긍정.
VOTES = 100

#: 몰표만 1.8배. 표를 더 던져도 이기지 못해야 한다.
MEGA_VOTES = 180

#: 데이터를 여러 벌 만들어 본다. 한 벌에서만 성립하는 성질은 성질이 아니다.
DATA_SEEDS = [7, 13, 29, 101]


def _scores(*, data_seed: int = 7, multiplier: float = model.INTERCEPT_MULTIPLIER):
    reactions, users = synthetic.build(seed=data_seed)
    reactions += synthetic.brigade(users, BRIGADE, VOTES)
    reactions += synthetic.bridging(users, BRIDGE, VOTES)
    reactions += synthetic.noisy(users, NOISE, VOTES)
    reactions += synthetic.brigade(users, MEGA, MEGA_VOTES)
    return model.fit(reactions, intercept_multiplier=multiplier)


# ── 전제 ───────────────────────────────────────────────────────────

def test_몰표와_브리징의_긍정_수가_같다():
    """이것이 깨지면 아래 결론이 무의미하다."""
    _, users = synthetic.build()
    brigade = synthetic.brigade(users, BRIGADE, VOTES)
    bridge = synthetic.bridging(users, BRIDGE, VOTES)
    assert sum(x.r for x in brigade) == sum(x.r for x in bridge) == VOTES


def test_진영이_실제로_학습된다():
    """f_u 가 진영을 갈라놓지 못하면 몰표 무력화는 애초에 성립할 수 없다."""
    reactions, users = synthetic.build()
    result = model.fit(reactions)
    a = sum(result.user_factor[u] for u in users["A"]) / len(users["A"])
    b = sum(result.user_factor[u] for u in users["B"]) / len(users["B"])
    assert a * b < 0, "두 진영의 잠재 성향 부호가 갈리지 않았다"


# ── ①②③ 세 시나리오 ────────────────────────────────────────────────

@pytest.mark.parametrize("data_seed", DATA_SEEDS)
def test_몰표는_품질_점수를_올리지_못한다(data_seed):
    """① 한쪽 진영만 대량 긍정 → b_i 상승하지 않음.

    이 플랫폼의 존재 이유다.
    """
    s = _scores(data_seed=data_seed).card_score
    assert s[BRIDGE] > s[BRIGADE], (
        f"같은 수의 긍정인데 몰표가 브리징을 이겼다 (seed {data_seed}): "
        f"몰표 {s[BRIGADE]:.4f} ≥ 브리징 {s[BRIDGE]:.4f}"
    )
    assert abs(s[BRIGADE]) < s[BRIDGE]


@pytest.mark.parametrize("data_seed", DATA_SEEDS)
def test_양_진영_긍정은_품질_점수를_올린다(data_seed):
    """② 양 진영 고르게 긍정 → b_i 뚜렷이 상승."""
    s = _scores(data_seed=data_seed).card_score
    assert s[BRIDGE] > 0
    assert s[BRIDGE] > s[NOISE]


@pytest.mark.parametrize("data_seed", DATA_SEEDS)
def test_무작위_반응은_영_근처다(data_seed):
    """③ 무작위 → b_i 0 근처."""
    s = _scores(data_seed=data_seed).card_score
    assert abs(s[NOISE]) < s[BRIDGE]


@pytest.mark.parametrize("data_seed", DATA_SEEDS)
def test_표를_더_던져도_몰표는_이기지_못한다(data_seed):
    """④ 몰표를 1.8배로 늘려도 브리징을 이기지 못한다.

    "몰표로는 상위 노출을 **살 수 없다**"가 요구다. 표를 더 사면 이긴다면
    그것은 값이 비싸진 것일 뿐 막은 것이 아니다.
    """
    s = _scores(data_seed=data_seed).card_score
    assert s[BRIDGE] > s[MEGA], (
        f"표를 더 던지니 몰표가 이겼다 (seed {data_seed}): "
        f"몰표 {s[MEGA]:.4f} ≥ 브리징 {s[BRIDGE]:.4f}"
    )


# ── 파라미터를 흔들어도 성질이 유지되는가 ──────────────────────────

@pytest.mark.parametrize("multiplier", [10, 15, 20, 30])
def test_절편_정규화를_키워도_성질이_유지된다(multiplier):
    """수용 기준이 요구하는 것 — 파라미터 튜닝 시에도 성질이 유지되는가."""
    s = _scores(multiplier=multiplier).card_score
    assert s[BRIDGE] > s[BRIGADE]
    assert s[BRIDGE] > s[MEGA]


@pytest.mark.parametrize("multiplier", [1, 5])
def test_절편_정규화가_약하면_성질이_깨진다(multiplier):
    """**왜 이 파라미터가 있는지**를 못박는 시험이다.

    명세(`03_ALGORITHMS_AI.md` §1.4)는 λ 하나만 적었고, 그대로 구현하면
    (= 배수 1) 몰표가 브리징을 이깁니다. 이유는 공선성입니다 — 한 진영만
    반응하면 f_u 가 거의 상수라 [1, f_u] 두 열이 평행해지고, 릿지는 노름이
    큰 상수열(절편)로 설명을 몰아줍니다.

    나중에 "λ 를 하나로 합치자"는 정리가 들어오면 이 시험이 막습니다.
    깨지는 것을 확인하는 시험이라 이상해 보이지만, 깨진다는 사실이야말로
    파라미터의 존재 이유입니다.
    """
    broken = 0
    for data_seed in DATA_SEEDS:
        s = _scores(data_seed=data_seed, multiplier=multiplier).card_score
        if s[BRIDGE] <= s[BRIGADE] or s[BRIDGE] <= s[MEGA]:
            broken += 1
    assert broken > 0, (
        f"배수 {multiplier} 에서도 성질이 유지된다면, 기본값 "
        f"{model.INTERCEPT_MULTIPLIER} 를 낮출 수 있는지 다시 보십시오."
    )


# ── 구조 확인 ──────────────────────────────────────────────────────

def test_브리징_카드는_편향이_작다():
    """점수만 보면 우연히 맞을 수 있다. 편향 f_i 까지 기대대로여야 모델이
    실제로 우리가 생각한 일을 하고 있는 것이다."""
    result = _scores()
    assert abs(result.card_bias[BRIDGE]) < abs(result.card_bias[BRIGADE])


def test_몰표_카드의_편향은_그_진영_쪽을_가리킨다():
    """편향 항이 몰표를 흡수하고 있다는 직접 증거."""
    reactions, users = synthetic.build()
    reactions += synthetic.brigade(users, BRIGADE, VOTES)
    result = model.fit(reactions)
    a_mean = sum(result.user_factor[u] for u in users["A"]) / len(users["A"])
    # 카드의 편향과 그 진영의 성향이 같은 방향이어야 한다.
    assert result.card_bias[BRIGADE] * a_mean > 0


# ── VS-F1 수용 기준 ────────────────────────────────────────────────

def test_두_번_돌리면_같은_결과다():
    """재현되지 않는 점수는 제재의 근거로 쓸 수 없다."""
    first, second = _scores(), _scores()
    assert first.snapshot_hash == second.snapshot_hash
    assert first.card_score == second.card_score
    assert first.card_bias == second.card_bias


def test_반응이_적은_카드는_점수를_내지_않는다():
    """카드당 20개 미만은 미산출. 몇 표로 매긴 품질은 품질이 아니라 잡음이다."""
    reactions, users = synthetic.build()
    reactions += synthetic.bridging(users, "card-thin", model.MIN_REACTIONS - 2)
    result = model.fit(reactions)
    assert "card-thin" not in result.card_score
    assert "card-thin" in result.skipped


def test_산출물에_사용자_성향이_담기지_않는다():
    """INV-2. 개인의 잠재 성향 f_u 는 외부로 공개하지 않는다."""
    dumped = json.loads(model.to_json(_scores()))
    assert "user_factor" not in dumped
    assert "user_offset" not in dumped
    assert dumped["snapshot_hash"] and dumped["model_version"] and dumped["seed"]
