#!/usr/bin/env bash
# G-PARITY 게이트 — Kotlin·C# 바인딩이 같은 계약을 노출하는지 기계적으로 확인한다.
#
# 코어 인터페이스를 바꾸고 한쪽 바인딩만 재생성하면 두 플랫폼이 조용히
# 갈라진다. 이 스크립트는 그 상태를 CI에서 실패로 만든다.
#   → docs/09_DEVELOPMENT_PLAN.md §1.4
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/target/bindings"
UDL="$ROOT/core/src/civicagora.udl"
CFG="$ROOT/core/uniffi.toml"

rm -rf "$OUT"
cargo run -q --manifest-path "$ROOT/core/Cargo.toml" --bin uniffi-bindgen -- \
    generate "$UDL" --language kotlin --out-dir "$OUT/kotlin" --config "$CFG" 2>&1 | grep -v ktlint || true
uniffi-bindgen-cs "$UDL" --out-dir "$OUT/csharp" --config "$CFG" 2>&1 | grep -v CSharpier || true

KT="$(find "$OUT/kotlin" -name '*.kt' | head -1)"
CS="$OUT/civicagora.cs"
[ -f "$CS" ] || CS="$OUT/csharp/civicagora.cs"

fail=0
check() {
    if [ "$2" = "$3" ]; then
        printf '  OK   %-24s %s\n' "$1" "$2"
    else
        printf '  FAIL %-24s kotlin=%s csharp=%s\n' "$1" "$2" "$3"
        fail=1
    fi
}

# 1) 네이티브 라이브러리 이름이 같아야 한다.
#    다르면 한쪽이 런타임에 라이브러리를 못 찾고 터진다.
kt_lib="$(grep -oP '(?<=return ")civicagora[a-z_]*(?=")' "$KT" | head -1)"
cs_lib="$(grep -oP '(?<=DllImport\(")[^"]+' "$CS" | head -1)"
check "cdylib 이름" "$kt_lib" "$cs_lib"

# 2) UDL의 dictionary 필드가 양쪽에 모두 나타나야 한다.
for field in $(grep -oP '^\s+\w+ \K\w+(?=;)' "$UDL" | sort -u); do
    camel="$(echo "$field" | sed -E 's/_([a-z])/\U\1/g')"
    kt_has=$(grep -c "\`$camel\`" "$KT" || true)
    cs_has=$(grep -c "@$camel" "$CS" || true)
    check "필드 $camel" "$([ "$kt_has" -gt 0 ] && echo 있음 || echo 없음)" \
                        "$([ "$cs_has" -gt 0 ] && echo 있음 || echo 없음)"
done

if [ "$fail" -ne 0 ]; then
    echo "G-PARITY 실패: 두 바인딩의 계약이 어긋난다." >&2
    exit 1
fi
echo "G-PARITY 통과"
