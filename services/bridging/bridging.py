"""브리징 행렬 분해 (VS-F1).

X(구 Twitter) Community Notes 알고리즘을 정책 토론에 맞게 변형한 것입니다.
목적은 하나입니다 — **특정 진영의 몰표로는 상위 노출을 살 수 없게 만드는 것.**

    r̂(u,i) = μ + b_u + b_i + f_u · f_i

| 기호 | 의미 |
|-|-|
| μ     | 전체 평균 반응률 |
| b_u   | 사용자의 관대함 (항상 긍정을 누르는 사람인가) |
| b_i   | **카드의 고유 품질 = 브리징 점수.** 랭킹의 기준값 |
| f_u   | 사용자의 잠재 성향 (d=1이면 좌우 축) |
| f_i   | 카드가 특정 진영에 어필하는 편향 |

## 왜 몰표가 무력화되는가

한 진영이 좌표를 찍어 💡를 누르면, 그 집단의 f_u 와 카드의 f_i 방향이 맞아
내적 항 f_u·f_i 가 커집니다. 손실을 줄이는 과정에서 **관측된 긍정이 이 내적
항만으로 설명되어 버리므로 고유 품질 b_i 는 올라가지 않습니다.**

부호가 반대인 두 집단이 모두 긍정을 보내면 내적 항으로는 양쪽을 동시에 설명할
수 없습니다. 남은 오차를 흡수할 수 있는 유일한 항이 b_i 이고, 그제서야 b_i 가
커집니다.

> 내 편만 밀어주면 편향 벡터가 흡수하고, 반대편까지 인정해야 품질이 오른다.

이 성질이 이 플랫폼의 존재 이유입니다. 이 파일을 고치면 `test_bridging.py`
(VS-F2)가 반드시 통과해야 합니다. 통과하지 못하면 남는 것은 그냥 또 하나의
인기투표 사이트입니다.

## 왜 ALS 인가

경사하강이 아니라 교대 최소제곱(ALS)을 씁니다. 각 단계가 **닫힌 해**라
학습률도 수렴 판정도 필요 없고, 같은 입력이면 같은 출력이 나옵니다.
결정론적 재현이 요구사항(G-DETERM)이므로 그 편이 낫습니다.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

import numpy as np

#: 모델 계약 버전. 산출물에 기록해 어느 모델이 낸 값인지 남긴다.
MODEL_VERSION = 1

#: 잠재 차원. 초기에는 좌우 단일 축 (docs/03_ALGORITHMS_AI.md §1.4).
LATENT_DIM = 1

#: 인자(f_u, f_i) 정규화. 명세의 값 (docs/03_ALGORITHMS_AI.md §1.4).
LAMBDA_FACTOR = 0.15

#: 절편(b_u, b_i)에는 더 강한 정규화를 건다.
#:
#: **이것이 없으면 몰표 무력화가 성립하지 않습니다.** 명세는 λ 하나만 적었고,
#: 그대로 구현했더니 VS-F2 가 실패했습니다.
#:
#: 이유는 공선성입니다. 한 진영만 반응하면 그 사람들의 f_u 가 거의 상수라
#: 설계행렬 [1, f_u] 의 두 열이 거의 평행해집니다. 이때 릿지는 **노름이 큰
#: 쪽**, 즉 상수열(절편)로 설명을 몰아줍니다. 몰표의 긍정이 편향 f_i 가
#: 아니라 품질 b_i 로 들어가 버립니다.
#:
#: 절편을 더 비싸게 만들면 같은 설명을 f_i 로 하는 편이 싸집니다. 양 진영이
#: 모두 긍정한 카드는 f_u 의 부호가 갈려 f_i 로는 설명할 수 없으므로, 그때는
#: 절편이 비싸도 b_i 가 올라갑니다. 그것이 우리가 원하는 성질입니다.
#:
#: 배수는 대략 1/|f_u|² 보다 커야 합니다 — 인자열의 노름이 상수열의 |f_u| 배이기
#: 때문입니다. 실측한 |f_u| ≈ 0.5 이므로 하한이 4 근처이고, 여유를 두어 10으로
#: 둡니다. 합성 데이터 4종에서 배수 1·5 는 깨지고 10부터 안정적으로 성립합니다
#: (test_bridging.py 참조).
INTERCEPT_MULTIPLIER = 10

LAMBDA_INTERCEPT = LAMBDA_FACTOR * INTERCEPT_MULTIPLIER

#: 카드당 최소 반응 수. 미만이면 b_i 를 내지 않는다 —
#: 몇 표로 매긴 품질 점수는 품질이 아니라 잡음이다.
MIN_REACTIONS = 20

#: 시드. 초기값에만 쓰이지만 고정해야 재현된다.
SEED = 20260924

#: 교대 횟수. 닫힌 해를 번갈아 풀므로 이 정도면 충분히 수렴한다.
ITERATIONS = 60


@dataclass(frozen=True)
class Reaction:
    """반응 하나. r ∈ {0,1} (💡🤝 → 1, 🔍⚖️ → 0)."""

    user: str
    card: str
    r: int


@dataclass
class Result:
    """배치 산출물."""

    #: 카드별 브리징 점수. 반응이 MIN_REACTIONS 미만인 카드는 들어 있지 않다.
    card_score: dict[str, float] = field(default_factory=dict)
    #: 카드별 편향 벡터.
    card_bias: dict[str, float] = field(default_factory=dict)
    #: 사용자별 관대함.
    user_offset: dict[str, float] = field(default_factory=dict)
    #: 사용자별 잠재 성향. **외부로 공개하지 않는다** (INV-2).
    user_factor: dict[str, float] = field(default_factory=dict)
    mu: float = 0.0
    #: 재현에 필요한 것들. 제3자가 같은 값을 다시 만들 수 있어야 한다.
    snapshot_hash: str = ""
    model_version: int = MODEL_VERSION
    seed: int = SEED
    skipped: list[str] = field(default_factory=list)


def snapshot_hash(reactions: list[Reaction]) -> str:
    """입력 스냅샷의 해시.

    산출물에 함께 기록해 **어느 데이터로 낸 값인지**를 못박는다. 이것이 없으면
    "다시 계산해 보니 다르다"는 말에 답할 수 없다.
    """
    digest = hashlib.sha256()
    for item in sorted(reactions, key=lambda x: (x.card, x.user)):
        digest.update(f"{item.card}\x1f{item.user}\x1f{item.r}\x1e".encode())
    return digest.hexdigest()


def _solve(design: np.ndarray, target: np.ndarray, penalty: np.ndarray) -> np.ndarray:
    """릿지 최소제곱 (2x2). 닫힌 해라 반복도 학습률도 없다.

    penalty 는 [절편, 인자] 순서의 대각 정규화다. 둘을 다르게 주는 것이
    이 모델의 핵심이다 — 위 LAMBDA_INTERCEPT 의 설명을 보라.
    """
    gram = design.T @ design + penalty
    return np.linalg.solve(gram, design.T @ target)


def fit(reactions: list[Reaction], *, lam_factor: float = LAMBDA_FACTOR,
        intercept_multiplier: float = INTERCEPT_MULTIPLIER,
        iterations: int = ITERATIONS, seed: int = SEED) -> Result:
    """반응 목록에서 브리징 점수를 계산한다.

    같은 입력이면 같은 출력이 나온다. 시드를 바꾸지 않는 한 재현된다.
    """
    if not reactions:
        return Result(snapshot_hash=snapshot_hash(reactions))

    users = sorted({x.user for x in reactions})
    cards = sorted({x.card for x in reactions})
    user_index = {name: i for i, name in enumerate(users)}
    card_index = {name: i for i, name in enumerate(cards)}

    rows = np.array([user_index[x.user] for x in reactions])
    cols = np.array([card_index[x.card] for x in reactions])
    values = np.array([float(x.r) for x in reactions])

    rng = np.random.default_rng(seed)
    # 초기값이 모두 0이면 내적 항의 기울기도 0이라 f 가 영원히 0에 머문다.
    # 작은 난수로 대칭을 깬다.
    user_factor = rng.normal(0.0, 0.1, len(users))
    card_bias_vec = rng.normal(0.0, 0.1, len(cards))
    user_offset = np.zeros(len(users))
    card_score = np.zeros(len(cards))
    mu = float(values.mean())

    penalty = np.diag([lam_factor * intercept_multiplier, lam_factor])

    # 사용자·카드별 관측 인덱스를 미리 묶어 둔다.
    by_user: list[np.ndarray] = [np.where(rows == u)[0] for u in range(len(users))]
    by_card: list[np.ndarray] = [np.where(cols == c)[0] for c in range(len(cards))]

    for _ in range(iterations):
        # ── 사용자 쪽: (b_u, f_u) 를 카드 파라미터 고정 상태에서 푼다 ──
        for u, idx in enumerate(by_user):
            if idx.size == 0:
                continue
            f_i = card_bias_vec[cols[idx]]
            design = np.column_stack([np.ones(idx.size), f_i])
            target = values[idx] - mu - card_score[cols[idx]]
            user_offset[u], user_factor[u] = _solve(design, target, penalty)

        # ── 카드 쪽: (b_i, f_i) 를 사용자 파라미터 고정 상태에서 푼다 ──
        for c, idx in enumerate(by_card):
            if idx.size == 0:
                continue
            f_u = user_factor[rows[idx]]
            design = np.column_stack([np.ones(idx.size), f_u])
            target = values[idx] - mu - user_offset[rows[idx]]
            card_score[c], card_bias_vec[c] = _solve(design, target, penalty)

        # ── μ: 나머지를 흡수한다. 정규화하지 않는다 ──
        residual = (values - user_offset[rows] - card_score[cols]
                    - user_factor[rows] * card_bias_vec[cols])
        mu = float(residual.mean())

    counts = {card: int(np.sum(cols == card_index[card])) for card in cards}
    enough = [card for card in cards if counts[card] >= MIN_REACTIONS]
    skipped = [card for card in cards if counts[card] < MIN_REACTIONS]

    return Result(
        card_score={c: float(card_score[card_index[c]]) for c in enough},
        card_bias={c: float(card_bias_vec[card_index[c]]) for c in enough},
        user_offset={u: float(user_offset[user_index[u]]) for u in users},
        user_factor={u: float(user_factor[user_index[u]]) for u in users},
        mu=mu,
        snapshot_hash=snapshot_hash(reactions),
        seed=seed,
        skipped=skipped,
    )


def to_json(result: Result) -> str:
    """산출물을 기록용 JSON 으로. 재현에 필요한 것을 함께 담는다.

    **사용자 잠재 성향 f_u 는 담지 않는다** — 개인의 정치 성향이며 외부로
    공개하지 않는다(INV-2, `docs/02_IDENTITY_PRIVACY.md` §3).
    """
    return json.dumps(
        {
            "model_version": result.model_version,
            "seed": result.seed,
            "snapshot_hash": result.snapshot_hash,
            "lambda_factor": LAMBDA_FACTOR,
            "lambda_intercept": LAMBDA_INTERCEPT,
            "latent_dim": LATENT_DIM,
            "min_reactions": MIN_REACTIONS,
            "mu": result.mu,
            "card_score": result.card_score,
            "card_bias": result.card_bias,
            "skipped": result.skipped,
        },
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
    )
