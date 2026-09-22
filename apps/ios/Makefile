# 맥에서 처음 받았을 때: make bootstrap && make run
#
# 윈도우·안드로이드와 달리 iOS 는 맥에서만 빌드된다. CI 에서 만들지 않는
# 이유도 그것이다 — 맥 러너 비용을 지금 단계에서 쓸 이유가 없다.

.PHONY: bootstrap core project open clean

bootstrap: core project ## 코어 빌드 + Xcode 프로젝트 생성

core: ## Rust 코어를 XCFramework 로 만들고 Swift 바인딩을 생성한다
	./scripts/build-core.sh

project: ## project.yml 에서 .xcodeproj 를 생성한다
	@command -v xcodegen >/dev/null || { echo "xcodegen 이 없습니다: brew install xcodegen"; exit 1; }
	xcodegen generate

open: ## Xcode 로 연다
	open CivicAgora.xcodeproj

clean:
	rm -rf Generated CivicAgora.xcodeproj
