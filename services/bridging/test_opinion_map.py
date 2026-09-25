"""VS-F4 — 여론 지형도 회귀 테스트.

군집이 **실제 진영을 복원하는가**를 봅니다. 이것이 성립하지 않으면 합의
판정(F5)도 브리프(H1)도 의미가 없습니다 — 엉뚱한 집단 사이의 "합의"를
합의라고 부르게 됩니다.

수치가 아니라 관계로 단언합니다. 실루엣 값 자체가 아니라 **k 를 옳게
고르는가**, **군집이 진영과 맞아떨어지는가**를 봅니다.
"""

from __future__ import annotations

import opinion_map as mapper
import synthetic


def _purity(result: mapper.OpinionMap, groups: dict[str, list[str]]) -> float:
    """각 군집에서 가장 많은 진영이 차지하는 비율의 평균."""
    where = {user: faction for faction, members in groups.items() for user in members}
    per_cluster: dict[int, list[str]] = {}
    for user, (_, _, cluster) in result.position.items():
        per_cluster.setdefault(cluster, []).append(where[user])

    scores = []
    for members in per_cluster.values():
        top = max(members.count(f) for f in set(members))
        scores.append(top / len(members))
    return sum(scores) / len(scores)


# ── 군집이 진영을 복원하는가 ───────────────────────────────────────

def test_두_진영을_둘로_나눈다():
    reactions, groups = synthetic.build(per_faction=120, background_cards=50)
    result = mapper.build(reactions)
    assert result.k == 2, f"k 가 {result.k} 로 나왔다"
    assert _purity(result, groups) > 0.95, "군집이 진영과 맞아떨어지지 않는다"


def test_세_진영이면_k도_늘어난다():
    """k 를 항상 2로 내놓는 구현을 걸러낸다."""
    reactions, groups = synthetic.build_three()
    result = mapper.build(reactions)
    assert result.k >= 3, f"진영이 셋인데 k 가 {result.k} 다"
    assert _purity(result, groups) > 0.9


def test_군집_인원_합이_참여자_수와_같다():
    reactions, _ = synthetic.build(per_faction=60, background_cards=40)
    result = mapper.build(reactions)
    assert sum(result.sizes.values()) == result.participants


# ── 결정론 (G-DETERM) ──────────────────────────────────────────────

def test_두_번_돌리면_같은_결과다():
    reactions, _ = synthetic.build(per_faction=60, background_cards=40)
    first, second = mapper.build(reactions), mapper.build(reactions)
    assert first.k == second.k
    assert first.sizes == second.sizes
    assert first.position == second.position
    assert first.snapshot_hash == second.snapshot_hash


def test_주성분_부호가_고정된다():
    """축이 뒤집히면 "왼쪽 군집"의 뜻이 돌릴 때마다 바뀐다."""
    reactions, _ = synthetic.build(per_faction=60, background_cards=40)
    first = mapper.build(reactions)
    second = mapper.build(reactions)
    for user, place in first.position.items():
        assert place[:2] == second.position[user][:2]


# ── 최소 인원 (INV-5) ──────────────────────────────────────────────

def test_반응이_적은_사람은_빠진다():
    reactions, _ = synthetic.build(per_faction=60, background_cards=40)
    reactions.append(synthetic.Reaction("신규참여자", "bg000", 1))
    result = mapper.build(reactions)
    assert "신규참여자" not in result.position


def test_사람이_적으면_지형도를_만들지_않는다():
    reactions, users = synthetic.build(per_faction=2, background_cards=10)
    result = mapper.build(reactions)
    assert result.k == 0
    assert result.position == {}


def test_작은_군집은_찬성률에서_빠진다():
    """인원 20명 미만 군집은 판정에서 제외한다 (INV-5)."""
    reactions, users = synthetic.build(per_faction=120, background_cards=50)
    result = mapper.build(reactions)
    # 작은 군집이 없는 데이터이므로, 임계값을 넘겨 강제로 만들어 확인한다.
    result.sizes[0] = mapper.MIN_CLUSTER_SIZE - 1
    rates = mapper.consensus(reactions, result)
    for per_cluster in rates.values():
        assert 0 not in per_cluster, "작은 군집이 찬성률에 들어갔다"


# ── 합의 추출 ──────────────────────────────────────────────────────

def test_양_진영이_찬성한_카드는_모든_군집에서_높다():
    reactions, users = synthetic.build(per_faction=120, background_cards=50)
    reactions += synthetic.common_ground(users, "card-common", ratio=0.8)
    # 한 진영만 찬성한 카드
    reactions += [synthetic.Reaction(u, "card-oneside", 1) for u in users["A"]]

    result = mapper.build(reactions)
    rates = mapper.consensus(reactions, result)

    common = rates["card-common"]
    assert len(common) >= 2
    assert min(common.values()) >= 0.60, f"합의 카드가 기준에 못 미친다: {common}"

    oneside = rates["card-oneside"]
    # 한쪽만 반응했으므로 다른 군집에는 자료가 없거나 값이 낮다.
    assert len(oneside) < len(common) or min(oneside.values()) < 0.60


# ── 합의 판정 (VS-F5) ──────────────────────────────────────────────

def test_양_진영_찬성_카드가_관문을_통과한다():
    reactions, users = synthetic.build(per_faction=120, background_cards=50)
    reactions += synthetic.common_ground(users, "card-common", ratio=0.8)
    result = mapper.build(reactions)
    rates = mapper.consensus(reactions, result)
    assert mapper.qualifies(rates["card-common"])


def test_한_진영만_찬성한_카드는_통과하지_못한다():
    """군집이 하나뿐이면 합의가 아니다 — 그냥 다수결이다."""
    reactions, users = synthetic.build(per_faction=120, background_cards=50)
    reactions += [synthetic.Reaction(u, "card-oneside", 1) for u in users["A"]]
    result = mapper.build(reactions)
    rates = mapper.consensus(reactions, result)
    assert not mapper.qualifies(rates["card-oneside"]), (
        f"한 진영만 눌렀는데 통과했다: {rates['card-oneside']}"
    )


def test_한_군집이라도_문턱에_못_미치면_통과하지_못한다():
    """평균이 아니라 최솟값으로 판정한다."""
    assert not mapper.qualifies({0: 0.95, 1: 0.55})
    assert mapper.qualifies({0: 0.61, 1: 0.60})


def test_이차_관문이_일차보다_엄격하다():
    """브리프 수록 기준(0.65)은 배너 기준(0.60)보다 높아야 한다."""
    assert mapper.BRIEF_THRESHOLD > mapper.BANNER_THRESHOLD
    rates = {0: 0.62, 1: 0.63}
    assert mapper.qualifies(rates)
    assert not mapper.qualifies(rates, threshold=mapper.BRIEF_THRESHOLD)
