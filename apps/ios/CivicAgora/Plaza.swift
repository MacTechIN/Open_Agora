import Foundation
import SwiftUI

/// 광장의 표시 규칙.
///
/// 웹(web/lib/plaza-view.ts)·Windows(MainWindow.xaml.cs)·Android(Plaza.kt)와
/// **같은 값**을 쓴다. 네 곳이 달라지면 같은 주제가 기기마다 다르게
/// 표시되고, 그것은 화면 버그가 아니라 신뢰 문제가 된다.
///
/// 이 값들이 코어(UDL)가 아니라 각 앱에 있는 이유는 표시 문구이기 때문이다.
/// 코어는 저장되는 것만 정한다.

/// 정렬 기준. 순서와 문구가 웹의 SORTS 와 같다.
enum PlazaSort: String, CaseIterable, Identifiable {
    case active, balance, recent, opinions
    var id: String { rawValue }
    var label: String {
        switch self {
        case .active: return "활발한 순"
        case .balance: return "균형 필요"
        case .recent: return "최신순"
        case .opinions: return "의견 많은 순"
        }
    }
}

/// 보기 방식. 웹의 VIEWS 와 같다.
enum PlazaViewMode: String, CaseIterable, Identifiable {
    case card, list, section
    var id: String { rawValue }
    var label: String {
        switch self {
        case .card: return "카드"
        case .list: return "목록"
        case .section: return "분류별"
        }
    }
}

/// 분류. UDL 의 PolicyCategory 순서를 따른다.
/// uniffi 가 만든 enum 은 CaseIterable 이 아니므로 여기에 순서를 적는다.
let categories: [(value: PolicyCategory, label: String)] = [
    (.govPolicy, "정부정책"),
    (.legislation, "입법안"),
    (.partyPolicy, "정당정책"),
    (.local, "지자체"),
    (.publicOrg, "공공기관"),
    (.socialIssue, "사회현안"),
    (.whistleblow, "문제고발"),
]

func categoryLabel(_ category: PolicyCategory) -> String {
    categories.first { $0.value == category }?.label ?? "기타"
}

func stanceLabel(_ stance: StanceType) -> String {
    switch stance {
    case .support: return "찬성"
    case .alternative: return "대안"
    case .oppose: return "반대"
    }
}

/// 좌우 어느 쪽도 우대하지 않도록 채도를 맞춘다. 다른 앱과 같은 값이다.
func stanceColor(_ stance: StanceType) -> Color {
    switch stance {
    case .support: return Color(red: 0x2E / 255, green: 0x7D / 255, blue: 0x6F / 255)
    case .alternative: return Color(red: 0x6A / 255, green: 0x5A / 255, blue: 0xCD / 255)
    case .oppose: return Color(red: 0x9E / 255, green: 0x5B / 255, blue: 0x4A / 255)
    }
}

func opinionTotal(_ s: PolicySummary) -> Int {
    Int(s.supportCount) + Int(s.alternativeCount) + Int(s.opposeCount)
}

/// 쏠린 정도. 1에 가까울수록 한쪽으로 기울었다.
///
/// 0대0 이나 1대0 은 기운 것이 아니라 아직 시작하지 않은 것이다. 그래서
/// 양쪽 합이 2 미만이면 정렬에서 뒤로 보낸다(-1).
func balanceScore(_ s: PolicySummary) -> Double {
    let sides = Int(s.supportCount) + Int(s.opposeCount)
    guard sides >= 2 else { return -1 }
    return Double(abs(Int(s.supportCount) - Int(s.opposeCount))) / Double(sides)
}

func needsBalance(_ s: PolicySummary) -> Bool { balanceScore(s) >= 0.6 }

/// 목록에 보이는 상대 시각.
func ago(_ epochMillis: Int64) -> String {
    let minutes = (Int64(Date().timeIntervalSince1970 * 1000) - epochMillis) / 60_000
    switch minutes {
    case ..<1: return "방금"
    case ..<60: return "\(minutes)분 전"
    case ..<1440: return "\(minutes / 60)시간 전"
    default: return "\(minutes / 1440)일 전"
    }
}

func shortenDid(_ did: String) -> String {
    did.count <= 24 ? did : String(did.prefix(24)) + "…"
}

/// 코어와 같은 기준으로 글자를 센다.
///
/// UI 가 따로 세면 한글 분해나 이모지 조합에서 기준이 갈려, 화면은
/// 149자라는데 제출이 거부되는 상황이 생긴다.
func countGraphemes(_ text: String) -> Int {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? 0 : Int(graphemeCount(text: trimmed))
}

/// 필드별 한도. 코어(core/src/card.rs, policy.rs)와 같아야 한다.
enum Limits {
    static let problem = 150
    static let evidence = 200
    static let solution = 150
    static let title = 60
    static let background = 300
    static let coreQuestion = 100
}
