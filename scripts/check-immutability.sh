#!/usr/bin/env bash
# G-IMMUT 게이트 — 삭제 경로가 생기지 않았는지 확인한다.
#
# 명세상 카드·댓글·안건은 등록 후 지울 수 없고 스탠스도 바꿀 수 없다. 대응은
# 디랭킹 → 블라인드 → 검색 제외 3단계 노출 조정뿐이다. 삭제 권한을 가진
# 주체를 만드는 순간 탈중앙 원칙이 무너진다.
#   → docs/00_PRODUCT_SPEC.md §7, docs/04_REPUTATION_MODERATION.md §3
#   → docs/09_DEVELOPMENT_PLAN.md §1.4 G-IMMUT
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

report() {
    printf '  FAIL %s\n' "$1"
    printf '%s\n' "$2" | sed 's/^/         /'
    fail=1
}

# 1) 저장 계층에 파괴적 SQL이 없어야 한다.
sql_hits="$(grep -rniE '\b(delete[[:space:]]+from|drop[[:space:]]+table|truncate)\b' \
    "$ROOT/core/src" 2>/dev/null || true)"
if [ -n "$sql_hits" ]; then
    report "파괴적 SQL이 발견되었습니다" "$sql_hits"
else
    echo "  OK   파괴적 SQL 없음"
fi

# 2) 카드 내용을 사후 변경하는 SQL이 없어야 한다.
#    카드는 등록 후 수정할 수 없다. 노출 상태를 나타내는 별도 테이블은
#    나중에 생길 수 있으나, cards 테이블 자체는 append-only다.
update_hits="$(grep -rniE 'update[[:space:]]+cards' "$ROOT/core/src" 2>/dev/null || true)"
if [ -n "$update_hits" ]; then
    report "cards 테이블을 수정하는 SQL이 있습니다" "$update_hits"
else
    echo "  OK   cards 수정 SQL 없음"
fi

# 3) 공개 인터페이스(UDL)에 삭제 함수가 없어야 한다.
#    UI가 호출할 수 있는 삭제 경로가 곧 삭제 기능이다.
udl_hits="$(grep -niE '^\s*[a-z_<>, ]*\b(delete|remove|erase|purge|wipe)_?[a-z_]*\s*\(' \
    "$ROOT/core/src/civicagora.udl" 2>/dev/null || true)"
if [ -n "$udl_hits" ]; then
    report "UDL에 삭제 함수가 선언되었습니다" "$udl_hits"
else
    echo "  OK   UDL에 삭제 함수 없음"
fi

# 4) 앱 코드에 삭제 동작이 없어야 한다.
#
#    한글 단어(삭제/지우기)를 찾지 않는다. "삭제 버튼이 없다"는 설명 주석을
#    삭제 기능으로 오인해 오탐이 났다. 주석을 걸러내려 했으나 여러 줄 주석까지
#    다루려면 파서가 필요하고, 그 복잡도를 감당할 이유가 없다.
#
#    대신 실행 가능한 코드 패턴만 본다 — 삭제 API 이름, 저장소 변경 호출,
#    XAML 삭제 핸들러와 버튼 라벨. 문서가 삭제의 부재를 설명하는 것은 통과한다.
#
#    "지우기"는 검색어를 비우는 버튼에도 쓴다. 입력칸을 비우는 것과 남의 글을
#    지우는 것은 다르므로, 검색·필터 초기화 핸들러에 걸린 것은 통과시킨다.
#    라벨만 보고 막으면 게이트를 우회하려고 라벨을 바꾸게 되고, 그러면
#    게이트가 UI 문구를 지배하게 된다.
ui_hits="$(grep -rnE \
    -e '\b(delete|remove)(Card|Post|Reply|Policy)\b' \
    -e '(_?store|Store)\.(Delete|Remove|Clear)\b' \
    -e 'Click="On(Delete|Remove)' \
    -e 'Content="(삭제|지우기)"' \
    -e 'text = "(삭제|지우기)"' \
    "$ROOT/apps/android/app/src/main" "$ROOT/apps/windows" 2>/dev/null \
    | grep -vE 'On(Clear|Reset)(Search|Filter|Query)' || true)"

if [ -n "$ui_hits" ]; then
    report "앱 코드에 삭제 동작이 있습니다" "$ui_hits"
else
    echo "  OK   앱 코드에 삭제 동작 없음"
fi

# 5) 서버(웹)에도 파괴적 SQL이 없어야 한다.
#
#    글의 정본이 코어의 SQLite 가 아니라 서버의 Postgres 로 옮겨 갔는데
#    게이트는 코어만 보고 있었다. 실제로 지울 수 있는 곳을 보지 않는 게이트는
#    게이트가 아니다.
#
#    대상을 **내용 표**로 좁힌다. 인증코드(verification_codes)는 쓰고 나면
#    지워야 하고, 그것을 막으면 코드가 영원히 남는다.
content_sql="$(grep -rniE '(delete[[:space:]]+from|truncate)[[:space:]]+(policies|cards|replies)\b|update[[:space:]]+(policies|cards|replies)[[:space:]]+set' \
    "$ROOT/web/lib" "$ROOT/web/app" 2>/dev/null || true)"
if [ -n "$content_sql" ]; then
    report "서버에 글을 지우거나 고치는 SQL이 있습니다" "$content_sql"
else
    echo "  OK   서버에 글 삭제·수정 SQL 없음"
fi

if [ "$fail" -ne 0 ]; then
    echo "G-IMMUT 실패: 삭제 경로가 생겼습니다." >&2
    exit 1
fi
echo "G-IMMUT 통과"
