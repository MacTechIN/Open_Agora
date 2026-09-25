#!/usr/bin/env python3
"""브리징 배치 (VS-F3).

공론장에서 반응 스냅샷을 받아 브리징 점수를 계산하고 돌려보냅니다.

    BRIDGING_SECRET=... python3 batch.py
    BRIDGING_SECRET=... CIVICAGORA_BASE=http://127.0.0.1:3115 python3 batch.py --dry-run

## 왜 데이터베이스에 직접 붙지 않는가

배치가 데이터베이스 자격증명을 갖게 되면 같은 열쇠가 GitHub 시크릿에도
있게 되고, 그만큼 샐 자리가 늘어납니다. HTTP 로 주고받으면 배치가 가진 것은
전용 비밀값 하나뿐입니다.

## 스냅샷에 필명이 없습니다

모델에 필요한 것은 "같은 사람인가"뿐이라 서버가 스냅샷 안에서만 통하는 번호로
바꿔 보냅니다. 스냅샷마다 번호를 다시 매기므로 두 스냅샷을 겹쳐도 같은 사람을
찾을 수 없습니다.

## 돌려보내는 것

**카드 단위 값만** 보냅니다. 사용자 잠재 성향 f_u 는 보내지 않습니다 —
개인의 정치 성향이며 외부로 공개하지 않습니다(INV-2).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

import opinion_map
from bridging import MODEL_VERSION, SEED, Reaction, fit, snapshot_hash

DEFAULT_BASE = "https://open-agora.vercel.app"
TIMEOUT = 120


def _call(base: str, path: str, secret: str, payload: dict | None = None) -> dict:
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {secret}",
            **({"Content-Type": "application/json"} if payload is not None else {}),
        },
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        raise SystemExit(f"{path}: HTTP {error.code} {body}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"{path}: 연결하지 못했습니다 — {error.reason}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description="브리징 점수 배치")
    parser.add_argument("--dry-run", action="store_true",
                        help="계산만 하고 결과를 보내지 않는다")
    args = parser.parse_args()

    secret = os.environ.get("BRIDGING_SECRET")
    if not secret:
        print("BRIDGING_SECRET 이 없습니다. 건너뜁니다.", file=sys.stderr)
        return 0

    base = os.environ.get("CIVICAGORA_BASE", DEFAULT_BASE)
    snapshot = _call(base, "/api/bridging/snapshot", secret)

    raw = snapshot.get("reactions", [])
    if not raw:
        print("반응이 없습니다. 계산할 것이 없습니다.")
        return 0

    reactions = [Reaction(user=f"u{u}", card=str(card), r=int(r)) for u, card, r in raw]
    digest = snapshot_hash(reactions)
    print(f"스냅샷: 반응 {len(reactions)}건 · 사람 {snapshot.get('user_count', 0)}명")
    print(f"해시:   {digest}")

    result = fit(reactions)
    scores = {
        card: {"score": result.card_score[card], "bias": result.card_bias[card]}
        for card in result.card_score
    }
    print(f"산출:   카드 {len(scores)}건 · 미산출 {len(result.skipped)}건 "
          f"(반응 부족)")
    for card, value in sorted(scores.items(), key=lambda kv: -kv[1]["score"])[:5]:
        print(f"  {card[:16]}…  b_i={value['score']:+.4f}  f_i={value['bias']:+.4f}")

    if args.dry_run:
        print("--dry-run 이므로 보내지 않습니다.")
        return 0

    sent = _call(base, "/api/bridging/scores", secret, {
        "model_version": MODEL_VERSION,
        "seed": SEED,
        "snapshot_hash": result.snapshot_hash,
        "scores": scores,
    })
    print(f"점수 저장: {sent.get('stored', 0)}건")

    # ── 여론 지형도 (VS-F4) ────────────────────────────────────────
    #
    # 좌표는 사람마다 하나씩 나오지만 **누구의 것인지는 공개하지 않는다**.
    # 서버가 본인 확인(영지식 증명)을 거친 사람에게만 자기 위치를 돌려준다.
    landscape = opinion_map.build(reactions)
    print(f"지형도: 참여 {landscape.participants}명 · 군집 {landscape.k}개 "
          f"· 실루엣 {landscape.silhouette:.3f}")
    if landscape.small:
        print(f"  인원 부족으로 판정에서 제외된 군집: {landscape.small}")

    if landscape.k > 0:
        mapped = _call(base, "/api/opinion-map", secret, {
            "snapshot_hash": landscape.snapshot_hash,
            "k": landscape.k,
            "silhouette": landscape.silhouette,
            "participants": landscape.participants,
            "seed": landscape.seed,
            "clusters": [
                {"id": c, "size": landscape.sizes[c],
                 "x": landscape.centroids[c][0], "y": landscape.centroids[c][1]}
                for c in sorted(landscape.sizes)
            ],
            "positions": [
                [who, place[0], place[1], place[2]]
                for who, place in sorted(landscape.position.items())
            ],
        })
        print(f"지형도 저장: {mapped.get('stored', 0)}명")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
