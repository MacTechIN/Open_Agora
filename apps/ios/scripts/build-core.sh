#!/usr/bin/env bash
# 공유 Rust 코어를 iOS용 XCFramework로 만들고 Swift 바인딩을 생성한다.
#
# 손으로 쓴 FFI 래퍼는 금지한다. 바인딩은 항상 UDL에서 생성한다 (G-PARITY).
#   → docs/05_CLIENT_APPS.md §1.2
#
# 맥에서 실행한다. Xcode(또는 Command Line Tools)와 Rust가 필요하다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IOS="$ROOT/apps/ios"
GEN="$IOS/Generated"          # 생성물. 커밋하지 않는다.
XC="$GEN/CivicAgoraCore.xcframework"

# 실기기(arm64)와 시뮬레이터. 시뮬레이터는 Apple Silicon 과 Intel 을 모두
# 담아야 한다 — 한쪽만 넣으면 다른 맥에서 "no such module" 로 실패한다.
TARGETS=(aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios)

echo "▸ Rust 타깃 설치"
for target in "${TARGETS[@]}"; do rustup target add "$target" >/dev/null; done

echo "▸ 코어 빌드 (release)"
for target in "${TARGETS[@]}"; do
    cargo build --release -p civicagora-core --target "$target"
done

echo "▸ 시뮬레이터 슬라이스 합치기"
rm -rf "$GEN"; mkdir -p "$GEN/sim"
lipo -create \
    "$ROOT/target/aarch64-apple-ios-sim/release/libcivicagora_core.a" \
    "$ROOT/target/x86_64-apple-ios/release/libcivicagora_core.a" \
    -output "$GEN/sim/libcivicagora_core.a"

echo "▸ Swift 바인딩 생성"
cargo run -q --manifest-path "$ROOT/core/Cargo.toml" --bin uniffi-bindgen -- \
    generate "$ROOT/core/src/civicagora.udl" \
    --language swift \
    --config "$ROOT/core/uniffi.toml" \
    --out-dir "$GEN/bindings"

# uniffi 는 civicagoraFFI.modulemap 이라는 이름으로 내놓지만 XCFramework 의
# 헤더 디렉터리는 module.modulemap 을 찾는다. 이름을 맞춰 준다.
mkdir -p "$GEN/headers"
cp "$GEN/bindings/civicagoraFFI.h" "$GEN/headers/"
cp "$GEN/bindings/civicagoraFFI.modulemap" "$GEN/headers/module.modulemap"

echo "▸ XCFramework 조립"
xcodebuild -create-xcframework \
    -library "$ROOT/target/aarch64-apple-ios/release/libcivicagora_core.a" -headers "$GEN/headers" \
    -library "$GEN/sim/libcivicagora_core.a" -headers "$GEN/headers" \
    -output "$XC"

# 생성된 Swift 파일은 앱 타깃이 직접 컴파일한다.
cp "$GEN/bindings/civicagora.swift" "$GEN/civicagora.swift"

echo "✓ 완료: $XC"
