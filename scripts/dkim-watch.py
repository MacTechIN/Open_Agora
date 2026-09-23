#!/usr/bin/env python3
"""DKIM 허용 도메인 감시 — VS-C2 보안 운영 절차.

ZK-Email 은 도메인의 DKIM 공개키를 신뢰의 뿌리로 씁니다. 그래서 두 가지를
계속 지켜봐야 합니다.

1. **폐기.** DNS 의 `p=` 가 비면 그 키는 폐기된 것입니다. 폐기된 키로 만든
   증명을 계속 받으면, 유출된 옛 키 하나로 그 도메인 사용자를 무제한
   위조할 수 있습니다. VS-C2 는 이때 `revokeDKIMPublicKeyHash` 를 부르도록
   요구합니다. 정리가 아니라 보안 조치입니다.

2. **키 길이 하락.** 1024비트 RSA 는 더 이상 안전 여유가 없습니다. 키 하나가
   깨지면 그 도메인 사용자를 무제한 위조할 수 있으므로 **2048비트 미만은
   허용하지 않습니다** (→ docs/13_VS_C0_FINDINGS.md §7.4).

셀렉터는 DNS 로 **열거할 수 없습니다.** 도메인이 어떤 셀렉터를 쓰는지는 그
도메인이 보낸 메일의 `DKIM-Signature: ... s=...` 헤더에만 있습니다. 그래서 이
도구는 셀렉터를 찾아 주지 못하고, **이미 아는 셀렉터를 지켜보기만** 합니다.
목록을 채우는 일은 사람이 메일을 받아서 해야 합니다.

    python3 scripts/dkim-watch.py                 # 허용 목록을 점검
    python3 scripts/dkim-watch.py --probe gmail.com   # 흔한 셀렉터를 찍어 본다
"""
import argparse
import base64
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ALLOWLIST = ROOT / "contracts" / "dkim-allowlist.json"

MIN_BITS = 2048

# 흔히 쓰는 셀렉터. 못 찾았다고 없는 것은 아닙니다 — 열거가 불가능하므로
# 이 목록은 편의일 뿐 근거가 되지 못합니다.
COMMON = [
    "selector1", "selector2", "google", "default", "dkim", "mail", "smtp", "mx",
    "k1", "k2", "s1", "s2", "s1024", "s2048", "key1", "key2",
    "20230601", "20240601", "20250601", "naver", "daum", "hanmail", "kakao",
    "nate", "protonmail", "protonmail2", "protonmail3", "mailer", "sendgrid",
]


def txt(name: str) -> str:
    """TXT 레코드를 한 줄로 이어 붙여 돌려줍니다."""
    out = subprocess.run(
        ["dig", "+short", "+time=3", "+tries=2", "TXT", name],
        capture_output=True, text=True,
    ).stdout
    return "".join(p.strip().strip('"') for p in out.split()).replace('""', "")


def der_length(der: bytes, i: int):
    """DER 길이 바이트를 읽어 (길이, 다음 위치)."""
    first = der[i]
    if first < 0x80:
        return first, i + 1
    count = first & 0x7F
    return int.from_bytes(der[i + 1:i + 1 + count], "big"), i + 1 + count


def key_bits(record: str):
    """(비트 수, 필드). 0 은 폐기, None 은 해석 실패."""
    fields = dict(kv.split("=", 1) for kv in record.split(";") if "=" in kv)
    encoded = fields.get("p", "").strip()
    if encoded == "":
        return 0, fields
    try:
        der = base64.b64decode(encoded + "=" * (-len(encoded) % 4))
    except Exception:
        return None, fields

    # RSAPublicKey 안에서 가장 긴 INTEGER 가 모듈러스입니다.
    # 길이 바이트가 1개인 경우(1024비트)와 2개인 경우(2048비트 이상)를
    # 모두 다룹니다 — 한쪽만 다루면 1024비트 키를 놓칩니다.
    best, i = 0, 0
    while i < len(der) - 2:
        if der[i] == 0x02:
            try:
                length, after = der_length(der, i + 1)
            except Exception:
                i += 1
                continue
            if 64 <= length <= 1024 and after + length <= len(der):
                best = max(best, len(der[after:after + length].lstrip(b"\x00")) * 8)
                i = after + length
                continue
        i += 1
    return (best or None), fields


def watch() -> int:
    if not ALLOWLIST.exists():
        print(f"허용 목록이 없습니다: {ALLOWLIST}", file=sys.stderr)
        return 2

    doc = json.loads(ALLOWLIST.read_text())
    failed = 0
    for entry in doc["domains"]:
        domain, selector = entry["domain"], entry["selector"]
        expected = entry.get("bits")
        record = txt(f"{selector}._domainkey.{domain}")

        if not record:
            print(f"  FAIL {domain:18} {selector:14} DNS 에 없습니다 — 셀렉터가 바뀌었을 수 있습니다")
            failed += 1
            continue

        bits, _ = key_bits(record)
        if bits == 0:
            print(f"  FAIL {domain:18} {selector:14} 폐기됨(p= 비어 있음). 레지스트리에서 취소해야 합니다")
            failed += 1
        elif bits is None:
            print(f"  FAIL {domain:18} {selector:14} 키를 해석하지 못했습니다")
            failed += 1
        elif bits < MIN_BITS:
            print(f"  FAIL {domain:18} {selector:14} {bits}비트 — {MIN_BITS}비트 미만은 허용하지 않습니다")
            failed += 1
        elif expected and bits != expected:
            print(f"  FAIL {domain:18} {selector:14} {bits}비트 — 기록된 {expected}비트와 다릅니다")
            failed += 1
        else:
            print(f"  OK   {domain:18} {selector:14} {bits}비트")

    if failed:
        print(f"\nDKIM 허용 목록에 문제 {failed}건. 가입 경로의 신뢰 뿌리이므로 방치하면 안 됩니다.",
              file=sys.stderr)
        return 1
    print(f"  OK   허용 도메인 {len(doc['domains'])}곳 모두 {MIN_BITS}비트 이상")
    return 0


def probe(domain: str) -> int:
    """흔한 셀렉터를 찍어 봅니다. 찾으면 운이 좋은 것이고, 못 찾아도 근거가 아닙니다."""
    found = 0
    for selector in COMMON:
        record = txt(f"{selector}._domainkey.{domain}")
        if not record:
            continue
        bits, fields = key_bits(record)
        state = "폐기" if bits == 0 else (f"{bits}비트" if bits else "해석 실패")
        print(f"  {domain:18} {selector:14} {state}  (k={fields.get('k', 'rsa')})")
        found += 1
    if found == 0:
        print(f"  {domain}: 흔한 셀렉터로는 찾지 못했습니다.")
        print("  셀렉터는 DNS 로 열거할 수 없습니다. 이 도메인이 보낸 메일의")
        print("  DKIM-Signature 헤더에서 s= 값을 읽어 허용 목록에 넣어야 합니다.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DKIM 허용 도메인 감시")
    parser.add_argument("--probe", metavar="DOMAIN", help="흔한 셀렉터를 찍어 본다")
    args = parser.parse_args()
    sys.exit(probe(args.probe) if args.probe else watch())
