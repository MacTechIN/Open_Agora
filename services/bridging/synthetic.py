"""합성 반응 데이터 (VS-F2).

## 왜 배경 카드가 필요한가

브리징이 몰표를 무력화하는 것은 **모델이 각 사용자의 진영(f_u)을 알고 있을
때**입니다. 시험 카드 하나만 덜렁 주면 모델은 f_u 를 추정할 근거가 없고, 그러면
성질 자체가 성립하지 않습니다.

그래서 배경 카드를 먼저 깔아 진영이 드러나게 합니다. 실제 공론장도 그렇습니다 —
사람들은 여러 카드에 반응하고, 그 누적이 성향을 드러냅니다.

## 왜 긍정 표 수를 맞추는가

몰표 카드와 브리징 카드에 **긍정 표를 같은 수**로 줍니다. 그러면 "긍정 수로
줄 세우는" 랭커는 둘을 구분하지 못합니다. 브리징 점수가 둘을 갈라놓는다면
그것은 표의 개수가 아니라 **누가 눌렀는가**를 본다는 뜻입니다.

한쪽이 표를 더 던지는 경우(④)도 둡니다. 몰표로 상위 노출을 **살 수 없다**는
것이 요구이므로, 표를 더 해도 이기지 못해야 합니다.
"""

from __future__ import annotations

import numpy as np

from bridging import Reaction

FACTION_A = "A"
FACTION_B = "B"


def _users(count: int, faction: str) -> list[str]:
    return [f"{faction}{i:03d}" for i in range(count)]


def build(
    *,
    per_faction: int = 200,
    background_cards: int = 80,
    seed: int = 7,
) -> tuple[list[Reaction], dict[str, list[str]]]:
    """배경 반응과 진영 명부를 만든다.

    배경 카드는 한쪽 진영에 어필합니다. 같은 진영은 대부분 긍정, 반대 진영은
    대부분 부정입니다. 이 누적이 모델에게 누가 어느 편인지 알려 줍니다.
    """
    rng = np.random.default_rng(seed)
    a_users = _users(per_faction, FACTION_A)
    b_users = _users(per_faction, FACTION_B)

    reactions: list[Reaction] = []
    for index in range(background_cards):
        card = f"bg{index:03d}"
        # 카드마다 어느 진영에 어필하는지 번갈아 정한다.
        favours_a = index % 2 == 0
        for user in a_users + b_users:
            # 모두가 모든 카드에 반응하지는 않는다. 실제와 같게 성기게 둔다.
            if rng.random() > 0.35:
                continue
            aligned = (user.startswith(FACTION_A)) == favours_a
            # 진영이 맞으면 대체로 긍정, 아니면 대체로 부정. 잡음을 남긴다.
            positive = rng.random() < (0.85 if aligned else 0.15)
            reactions.append(Reaction(user, card, 1 if positive else 0))

    return reactions, {FACTION_A: a_users, FACTION_B: b_users}


def brigade(users: dict[str, list[str]], card: str, votes: int) -> list[Reaction]:
    """① 한쪽 진영만 대량 긍정. 좌표를 찍은 상황."""
    chosen = users[FACTION_A][:votes]
    if len(chosen) < votes:
        raise ValueError(
            f"진영 A 에 {votes}명이 필요한데 {len(chosen)}명뿐입니다. "
            "per_faction 을 늘리십시오 — 표 수를 맞추지 못하면 시험이 무의미해집니다."
        )
    return [Reaction(user, card, 1) for user in chosen]


def bridging(users: dict[str, list[str]], card: str, votes: int) -> list[Reaction]:
    """② 양 진영 고르게 긍정. 반대편까지 인정한 카드."""
    half = votes // 2
    return ([Reaction(user, card, 1) for user in users[FACTION_A][:half]]
            + [Reaction(user, card, 1) for user in users[FACTION_B][:half]])


def noisy(users: dict[str, list[str]], card: str, votes: int, seed: int = 11) -> list[Reaction]:
    """③ 무작위 반응. 아무 신호도 없는 카드."""
    rng = np.random.default_rng(seed)
    half = votes // 2
    chosen = users[FACTION_A][:half] + users[FACTION_B][:half]
    return [Reaction(user, card, int(rng.random() < 0.5)) for user in chosen]


FACTION_C = "C"


def build_three(
    *,
    per_faction: int = 80,
    background_cards: int = 60,
    seed: int = 21,
) -> tuple[list[Reaction], dict[str, list[str]]]:
    """진영이 셋인 데이터.

    실루엣이 k 를 제대로 고르는지 보려면 둘이 아닌 경우가 있어야 합니다.
    k=2 만 시험하면 "항상 2를 내놓는" 구현도 통과합니다.
    """
    rng = np.random.default_rng(seed)
    groups = {
        FACTION_A: _users(per_faction, FACTION_A),
        FACTION_B: _users(per_faction, FACTION_B),
        FACTION_C: _users(per_faction, FACTION_C),
    }
    names = list(groups)

    reactions: list[Reaction] = []
    for index in range(background_cards):
        card = f"bg3{index:03d}"
        favours = names[index % 3]
        for faction, members in groups.items():
            for user in members:
                if rng.random() > 0.4:
                    continue
                aligned = faction == favours
                positive = rng.random() < (0.85 if aligned else 0.12)
                reactions.append(Reaction(user, card, 1 if positive else 0))

    return reactions, groups


def common_ground(users: dict[str, list[str]], card: str, ratio: float = 0.75,
                  seed: int = 33) -> list[Reaction]:
    """모든 진영이 고르게 찬성하는 카드. 합의 배너의 후보다."""
    rng = np.random.default_rng(seed)
    out = []
    for members in users.values():
        for user in members:
            out.append(Reaction(user, card, 1 if rng.random() < ratio else 0))
    return out
