#!/usr/bin/env python3
"""고정한 영지식 아티팩트가 바뀌지 않았는지 확인한다 (VS-C1).

증명 아티팩트는 신뢰의 뿌리다. 바뀐 아티팩트로 증명을 만들면 검증이 통과해도
그 증명이 무엇을 뜻하는지 우리가 알 수 없다. 기본 동작인 런타임 다운로드를
없앤 이유가 그것이고, 고정했으면 고정된 채로 있는지 확인해야 한다.
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "contracts" / "semaphore-artifacts.json"
ARTIFACTS = ROOT / "web" / "public" / "semaphore"

doc = json.loads(MANIFEST.read_text())
failed = 0

for entry in doc["files"]:
    path = ARTIFACTS / entry["file"]
    if not path.exists():
        print(f"  FAIL {entry['file']}  없습니다")
        failed += 1
        continue
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry["sha256"]:
        print(f"  FAIL {entry['file']}  해시가 다릅니다")
        print(f"         기록 {entry['sha256']}")
        print(f"         실제 {digest}")
        failed += 1
    elif len(data) != entry["bytes"]:
        print(f"  FAIL {entry['file']}  크기가 다릅니다 ({len(data)} ≠ {entry['bytes']})")
        failed += 1
    else:
        print(f"  OK   {entry['file']:22} {len(data):>9,}바이트")

# 매니페스트에 없는 파일이 끼어들지 않았는지도 본다. 목록에 없는 파일이
# 있으면 무엇이 쓰이는지 알 수 없다.
known = {e["file"] for e in doc["files"]}
for path in sorted(ARTIFACTS.iterdir()) if ARTIFACTS.exists() else []:
    if path.name not in known:
        print(f"  FAIL {path.name}  매니페스트에 없는 파일입니다")
        failed += 1

if failed:
    print(f"\n아티팩트가 기록과 다릅니다 ({failed}건). 증명의 뿌리이므로 방치하면 안 됩니다.",
          file=sys.stderr)
    sys.exit(1)
print(f"  OK   Semaphore {doc['artifact_version']} 아티팩트 {len(doc['files'])}개 일치 "
      f"(깊이 {doc['tree_depth']}, 최대 {doc['max_members']:,}명)")
