# CivicAgora — iOS

맥에서 `git pull` 한 뒤 바로 이어서 작업할 수 있도록 만들어 둔 공간입니다.
리눅스·윈도우에서는 빌드할 수 없으므로 **컴파일 검증이 되지 않은 상태**입니다.
맥에서 처음 빌드할 때 오류가 나면 그것은 예상된 일이고, 아래 순서대로 잡으면
됩니다.

## 처음 한 번

```bash
brew install xcodegen          # .xcodeproj 생성기
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

## 빌드

```bash
cd apps/ios
make bootstrap                 # 코어 XCFramework + Swift 바인딩 + .xcodeproj
make open                      # Xcode 로 연다
```

`make bootstrap` 이 하는 일:

1. `civicagora-core` 를 iOS 3개 타깃(실기기 arm64, 시뮬레이터 arm64/x86_64)으로
   빌드
2. 시뮬레이터 두 슬라이스를 `lipo` 로 합침
3. UDL 에서 Swift 바인딩 생성 (**손으로 쓰지 않습니다** — G-PARITY)
4. `CivicAgoraCore.xcframework` 조립
5. `project.yml` → `CivicAgora.xcodeproj`

산출물은 전부 `Generated/` 아래에 생기고 커밋하지 않습니다.

## `.xcodeproj` 를 커밋하지 않는 이유

병합할 수 없는 파일이기 때문입니다. 두 사람이 각자 파일을 추가하면 충돌이 나고,
충돌을 손으로 풀다 보면 프로젝트 파일이 조용히 망가집니다. 명세(`project.yml`)만
커밋하고 프로젝트는 생성합니다.

## 구조

| 파일 | 역할 | 대응하는 다른 앱 |
|-|-|-|
| `Plaza.swift` | 정렬·분류·균형 판정 등 표시 규칙 | `Plaza.kt`, `plaza-view.ts` |
| `ApiClient.swift` | HTTP 전송만. 본문·파싱은 코어 | `ApiClient.kt`, `ApiClient.cs` |
| `DeviceIdentity.swift` | Secure Enclave P-256 키, DID | `DeviceIdentity.kt` |
| `CivicAgoraApp.swift` | 상태와 화면 전환 | `MainActivity.kt` |
| `PlazaView.swift` | 광장 목록·검색·칩·정렬 | `PlazaScreen.kt` |
| `DetailView.swift` | 주제 상세, 의견 | `DetailScreen.kt` |
| `NewTopicView.swift` | 주제 올리기 | `NewTopicScreen.kt` |
| `OpinionFormView.swift` | 3단 구조화 입력 | `OpinionForm.kt`, `OpinionForm.cs` |
| `MemberView.swift` | 시민 인증 | `MemberScreen.kt` |

## 맥에서 확인할 것

- [ ] `make bootstrap` 성공
- [ ] 시뮬레이터에서 광장에 웹과 같은 주제가 보이는가
- [ ] 검색·분류 칩·정렬 4종·보기 3종이 도는가
- [ ] 실기기에서 `DeviceIdentity` 가 **Secure Enclave** 로 표시되는가
      (시뮬레이터는 소프트웨어로 내려갑니다 — 정상입니다)
- [ ] 앱을 껐다 켜도 DID 가 같은가
- [ ] 시민 인증 후 의견이 올라가는가

마지막 두 개가 중요합니다. 재시작마다 DID 가 바뀌면 같은 사람이 매번 다른
사람이 되고, 회원 자격이 의미를 잃습니다. Windows 에서 실제로 났던 문제입니다.

## CI 에서 빌드하지 않는 이유

맥 러너는 리눅스의 10배 단가입니다. iOS 앱이 실제로 배포될 단계(TestFlight)에
가서 붙이는 것이 낫고, 그 전까지는 맥에서 손으로 확인합니다.
`docs/09_DEVELOPMENT_PLAN.md` VS-A3-iOS 를 보십시오.

## 아직 없는 것

- 앱 아이콘 (`Assets.xcassets`) — TestFlight 전에 필요합니다
- 작성자 서명 — `DeviceIdentity.sign` 은 있지만 아직 부르는 곳이 없습니다 (VS-A4)
- 리포트 다운로드 (PDF/DOCX/TXT) — D18
