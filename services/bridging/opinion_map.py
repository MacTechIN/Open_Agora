"""여론 지형도 — Pol.is 방식 군집화 (VS-F4).

`docs/03_ALGORITHMS_AI.md` §2.1 의 절차입니다.

    1. 시민 × 카드 반응 행렬  (긍정 +1, 부정 -1, 미반응 0)
    2. PCA 로 2차원 투영      (여론 지형도 시각화에 그대로 쓴다)
    3. K-Means 군집화         (k 는 실루엣 계수로 2~5 자동 선택)

## 왜 직접 구현하는가

sklearn 을 쓰지 않습니다. 의존성을 아끼려는 것이 아니라 **결정론** 때문입니다.
같은 입력이 같은 군집을 내야 합의 판정을 제재의 근거로 쓸 수 있고, 그러려면
초기화와 반복 횟수를 우리가 쥐고 있어야 합니다(G-DETERM).

## 부호를 고정한다

PCA 의 주성분은 부호가 임의입니다 — 같은 데이터로 돌려도 축이 뒤집힐 수
있습니다. 그러면 "왼쪽 군집"이 실행할 때마다 바뀌어 사람을 헷갈리게 합니다.
**절댓값이 가장 큰 적재값을 양수로** 맞춰 고정합니다.

## 무엇을 공개하는가

좌표는 사람마다 하나씩 나오지만, **누구의 것인지는 공개하지 않습니다**(INV-2).
공개하는 것은 군집 요약과 **식별자 없는 점 구름**뿐입니다. 점 구름이 안전한
이유는 개인의 반응 이력이 어디에도 공개되지 않기 때문입니다 — 남의 점을
짚어낼 단서가 없습니다.

내 위치는 영지식 증명으로 본인임을 보인 사람에게만 돌려줍니다.

인원 20명 미만 군집은 찬성률을 산출하지 않습니다(INV-5).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from bridging import Reaction, snapshot_hash

#: 군집 수 후보. 명세 §2.1.
K_RANGE = range(2, 6)

#: 이 인원 미만의 군집은 찬성률을 내지 않는다 (INV-5).
MIN_CLUSTER_SIZE = 20

#: 지형도를 공개할 최소 참여 인원 (INV-5, 안건 50명 기준).
MIN_PARTICIPANTS = 50

#: 이 횟수 미만으로 반응한 사람은 군집화에서 뺀다.
#: 한두 번 누른 사람의 위치는 위치가 아니라 잡음이다.
MIN_REACTIONS_PER_USER = 3

#: K-Means 초기화 시드. 고정해야 재현된다.
SEED = 20260925

#: K-Means 반복 횟수. 중심이 움직이지 않으면 일찍 멈춘다.
ITERATIONS = 100


@dataclass
class OpinionMap:
    """군집화 결과."""

    #: 사람별 (x, y, 군집). **공개하지 않는다** — 내 위치 조회에만 쓴다.
    position: dict[str, tuple[float, float, int]] = field(default_factory=dict)
    #: 군집별 인원.
    sizes: dict[int, int] = field(default_factory=dict)
    #: 군집별 중심 좌표.
    centroids: dict[int, tuple[float, float]] = field(default_factory=dict)
    k: int = 0
    silhouette: float = 0.0
    participants: int = 0
    snapshot_hash: str = ""
    seed: int = SEED
    #: 인원이 모자라 판정에서 제외된 군집.
    small: list[int] = field(default_factory=list)


def _matrix(reactions: list[Reaction]) -> tuple[np.ndarray, list[str], list[str]]:
    """긍정 +1 · 부정 -1 · 미반응 0 의 행렬을 만든다 (Pol.is 방식)."""
    users = sorted({x.user for x in reactions})
    cards = sorted({x.card for x in reactions})
    user_index = {u: i for i, u in enumerate(users)}
    card_index = {c: i for i, c in enumerate(cards)}

    matrix = np.zeros((len(users), len(cards)))
    for item in reactions:
        matrix[user_index[item.user], card_index[item.card]] = 1.0 if item.r == 1 else -1.0
    return matrix, users, cards


def _pca2(matrix: np.ndarray) -> np.ndarray:
    """중심을 옮기고 상위 두 주성분으로 투영한다. 부호를 고정한다."""
    centered = matrix - matrix.mean(axis=0, keepdims=True)
    # 특이값 분해. 공분산 고유분해보다 수치적으로 안정하다.
    _, _, components = np.linalg.svd(centered, full_matrices=False)
    axes = components[:2]

    # 부호 고정: 절댓값이 가장 큰 적재값을 양수로. 이것이 없으면 돌릴 때마다
    # 축이 뒤집혀 "왼쪽 군집"의 뜻이 바뀐다.
    for i in range(axes.shape[0]):
        dominant = np.argmax(np.abs(axes[i]))
        if axes[i, dominant] < 0:
            axes[i] = -axes[i]

    return centered @ axes.T


def _kmeans(points: np.ndarray, k: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """k-means++ 초기화에 고정 시드. 중심이 멈추면 일찍 끝낸다."""
    rng = np.random.default_rng(seed)
    n = points.shape[0]

    # k-means++: 첫 중심은 무작위, 이후는 기존 중심에서 먼 점을 확률적으로 고른다.
    centers = [points[rng.integers(n)]]
    for _ in range(1, k):
        distance = np.min(
            [np.sum((points - c) ** 2, axis=1) for c in centers], axis=0
        )
        total = distance.sum()
        # 모든 점이 겹치면 확률을 만들 수 없다. 그때는 아무 점이나 쓴다.
        index = rng.integers(n) if total <= 0 else rng.choice(n, p=distance / total)
        centers.append(points[index])
    centroids = np.array(centers)

    labels = np.zeros(n, dtype=int)
    for _ in range(ITERATIONS):
        distance = np.linalg.norm(points[:, None, :] - centroids[None, :, :], axis=2)
        new_labels = np.argmin(distance, axis=1)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for c in range(k):
            member = points[labels == c]
            # 빈 군집은 그대로 둔다. 무작위로 되살리면 결정론이 깨진다.
            if len(member) > 0:
                centroids[c] = member.mean(axis=0)
    return labels, centroids


def _silhouette(points: np.ndarray, labels: np.ndarray) -> float:
    """실루엣 계수 평균. 군집이 하나뿐이면 정의되지 않는다.

    O(n²) 이다. 참여자가 수천을 넘으면 표본으로 바꿔야 한다.
    """
    unique = np.unique(labels)
    if len(unique) < 2:
        return -1.0

    distance = np.linalg.norm(points[:, None, :] - points[None, :, :], axis=2)
    scores = []
    for i in range(len(points)):
        same = labels == labels[i]
        same[i] = False
        if not same.any():
            continue  # 혼자 있는 군집은 뺀다
        a = distance[i, same].mean()
        b = min(
            distance[i, labels == other].mean()
            for other in unique
            if other != labels[i] and (labels == other).any()
        )
        scores.append((b - a) / max(a, b))
    return float(np.mean(scores)) if scores else -1.0


def build(reactions: list[Reaction], *, seed: int = SEED) -> OpinionMap:
    """반응에서 여론 지형도를 만든다."""
    digest = snapshot_hash(reactions)
    if not reactions:
        return OpinionMap(snapshot_hash=digest, seed=seed)

    # 한두 번 누른 사람은 뺀다. 그 위치는 위치가 아니라 잡음이다.
    counts: dict[str, int] = {}
    for item in reactions:
        counts[item.user] = counts.get(item.user, 0) + 1
    enough = {u for u, n in counts.items() if n >= MIN_REACTIONS_PER_USER}
    filtered = [x for x in reactions if x.user in enough]

    if len({x.user for x in filtered}) < max(K_RANGE) or len({x.card for x in filtered}) < 2:
        # 군집을 나눌 만큼 모이지 않았다.
        return OpinionMap(
            snapshot_hash=digest, seed=seed, participants=len(enough)
        )

    matrix, users, _ = _matrix(filtered)
    points = _pca2(matrix)

    best_k, best_labels, best_centroids, best_score = 0, None, None, -2.0
    for k in K_RANGE:
        if k >= len(users):
            continue
        labels, centroids = _kmeans(points, k, seed)
        score = _silhouette(points, labels)
        if score > best_score:
            best_k, best_labels, best_centroids, best_score = k, labels, centroids, score

    if best_labels is None:
        return OpinionMap(snapshot_hash=digest, seed=seed, participants=len(users))

    sizes = {int(c): int((best_labels == c).sum()) for c in range(best_k)}
    return OpinionMap(
        position={
            users[i]: (float(points[i, 0]), float(points[i, 1]), int(best_labels[i]))
            for i in range(len(users))
        },
        sizes=sizes,
        centroids={
            int(c): (float(best_centroids[c, 0]), float(best_centroids[c, 1]))
            for c in range(best_k)
        },
        k=best_k,
        silhouette=best_score,
        participants=len(users),
        snapshot_hash=digest,
        seed=seed,
        small=[c for c, n in sizes.items() if n < MIN_CLUSTER_SIZE],
    )


def consensus(
    reactions: list[Reaction], opinion_map: OpinionMap
) -> dict[str, dict[int, float]]:
    """카드별·군집별 찬성률.

    **인원 20명 미만 군집은 빼고 셉니다**(INV-5). 몇 명의 찬성률은 찬성률이
    아니라 잡음이고, 그것으로 합의를 판정하면 소수가 합의를 좌우합니다.
    """
    counted: dict[str, dict[int, list[int]]] = {}
    for item in reactions:
        place = opinion_map.position.get(item.user)
        if place is None:
            continue
        cluster = place[2]
        if opinion_map.sizes.get(cluster, 0) < MIN_CLUSTER_SIZE:
            continue
        counted.setdefault(item.card, {}).setdefault(cluster, []).append(item.r)

    return {
        card: {cluster: sum(values) / len(values) for cluster, values in per.items()}
        for card, per in counted.items()
    }
