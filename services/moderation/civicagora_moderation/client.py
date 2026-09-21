"""TypeSafe System One HTTP 클라이언트.

API 자격증명은 서버에만 둔다. 네이티브 앱에 키를 심으면 추출된다.

명세: docs/10_AI_JUDGMENTS.md
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from .policy import Judgments

API_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"


class ModerationUnavailable(RuntimeError):
    """판단 서비스를 쓸 수 없다.

    호출부는 이 예외를 '유해함'으로 해석해서는 안 된다. 판정 불능일 때
    조용히 차단하면 검열이 되고, 조용히 통과시키면 게이트가 무의미해진다.
    사람 검토 대기로 보내는 것이 옳다.
    """


def ask(
    state: dict[str, Any],
    questions: dict[str, dict[str, Any]],
    *,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    timeout: float = 10.0,
) -> dict[str, Any]:
    """질문 묶음을 한 번의 요청으로 보낸다.

    질문들은 서로의 답을 보지 못하고 병렬로 처리되므로, 독립적인 판단은
    나눠 보내지 말고 함께 보낸다.
    """
    key = api_key or os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise ModerationUnavailable("TYPESAFE_API_KEY 미설정")

    payload = json.dumps(
        {"state": state, "model": model, "questions": questions},
        ensure_ascii=False,
    ).encode("utf-8")

    request = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ModerationUnavailable(str(exc)) from exc


def parse_answers(response: dict[str, Any]) -> Judgments:
    """API 응답을 판단값으로 변환한다.

    필드가 없으면 기본값으로 때우지 않고 예외를 낸다. 응답 형식이 바뀌었는데
    조용히 0.0으로 채우면 모든 글이 통과해 버린다.
    """
    answers = response.get("answers")
    if not isinstance(answers, dict):
        raise ModerationUnavailable("응답에 answers가 없다")

    def require(qid: str) -> dict[str, Any]:
        value = answers.get(qid)
        if not isinstance(value, dict):
            raise ModerationUnavailable(f"응답에 {qid} 답이 없다")
        return value

    attack_target = require("attack_target")
    severity = require("norm_severity")
    evidence = answers.get("evidence_relation")

    return Judgments(
        is_personal_attack=float(require("is_personal_attack")["noul"]),
        attack_target=str(attack_target["choice"]),
        attack_target_confidence=float(attack_target.get("confidence", 0.0)),
        norm_severity=float(severity["score"]),
        norm_severity_confidence=float(severity.get("confidence", 0.0)),
        solution_is_actionable=float(require("solution_is_actionable")["noul"]),
        evidence_relation=(
            str(evidence["choice"]) if isinstance(evidence, dict) else None
        ),
        evidence_confidence=(
            float(evidence.get("confidence", 0.0)) if isinstance(evidence, dict) else 0.0
        ),
        raw=answers,
    )
