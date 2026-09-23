import SwiftUI

/// 광장 — 공론 중인 주제 목록.
///
/// 주제가 수백 개가 되면 문제는 스크롤 길이가 아니라 "무엇을 봐야 할지
/// 모른다"는 것이다. 웹·Windows·Android 와 같은 탐색 수단을 둔다:
/// 검색, 분류 칩, 정렬 4종, 보기 3종.
struct PlazaView: View {
    @EnvironmentObject private var model: AppModel

    @State private var draft = ""
    @State private var query = ""
    @State private var category: PolicyCategory?
    @State private var sort: PlazaSort = .active
    @State private var mode: PlazaViewMode = .card

    private var shown: [PolicySummary] {
        var items = model.policies

        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            // 제목만 보면 "지역화폐"로 검색했을 때 제목에 그 말이 없는 주제를 놓친다.
            let needle = query.trimmingCharacters(in: .whitespaces)
            items = items.filter {
                contains($0.policy.title, needle)
                    || contains($0.policy.coreQuestion, needle)
                    || contains($0.policy.background, needle)
                    || contains($0.policy.targetAgency, needle)
            }
        }
        if let category {
            items = items.filter { $0.policy.category == category }
        }

        switch sort {
        case .recent:
            return items.sorted { $0.policy.createdAt > $1.policy.createdAt }
        case .opinions:
            return items.sorted {
                opinionTotal($0) != opinionTotal($1)
                    ? opinionTotal($0) > opinionTotal($1)
                    : $0.lastActivityAt > $1.lastActivityAt
            }
        case .balance:
            return items.sorted {
                balanceScore($0) != balanceScore($1)
                    ? balanceScore($0) > balanceScore($1)
                    : opinionTotal($0) > opinionTotal($1)
            }
        case .active:
            return items.sorted { $0.lastActivityAt > $1.lastActivityAt }
        }
    }

    private func contains(_ haystack: String?, _ needle: String) -> Bool {
        haystack?.range(of: needle, options: .caseInsensitive) != nil
    }

    private var filtered: Bool {
        !query.trimmingCharacters(in: .whitespaces).isEmpty || category != nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(headline).font(.headline)

                HStack {
                    TextField("주제·쟁점 질문·기관 검색", text: $draft)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { query = draft.trimmingCharacters(in: .whitespaces) }
                    Button("검색") { query = draft.trimmingCharacters(in: .whitespaces) }
                    if !query.isEmpty {
                        Button("지우기") { draft = ""; query = "" }
                    }
                }

                // 분류 칩. 개수를 함께 보여 어디에 무엇이 있는지 알린다.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Chip(label: "전체 \(model.policies.count)", on: category == nil) {
                            category = nil
                        }
                        ForEach(categories, id: \.value) { item in
                            let count = model.policies.filter { $0.policy.category == item.value }.count
                            // 비어 있는 분류는 숨긴다. 고를 수 없는 것을 보여줄 이유가 없다.
                            if count > 0 || category == item.value {
                                Chip(label: "\(item.label) \(count)", on: category == item.value) {
                                    category = item.value
                                }
                            }
                        }
                    }
                }

                ChoiceRow(title: "정렬", options: PlazaSort.allCases, selected: $sort) { $0.label }
                ChoiceRow(title: "보기", options: PlazaViewMode.allCases, selected: $mode) { $0.label }

                if sort == .balance {
                    Text("한쪽으로 기운 주제를 먼저 보여줍니다. 반대편 의견이 가장 필요한 곳입니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if model.busy { ProgressView() }
                if let error = model.error { ErrorNotice(message: error) }
                if model.isMember == false { MemberNotice() }

                if shown.isEmpty {
                    Text(filtered
                         ? "조건에 맞는 주제가 없습니다. 검색어를 바꾸거나 분류를 전체로 두고 다시 찾아보세요."
                         : "아직 올라온 주제가 없습니다. 공론화하고 싶은 정책이나 현안을 첫 번째로 올려보세요.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    content
                }
            }
            .padding(16)
        }
        .refreshable { await model.loadPlaza() }
    }

    private var headline: String {
        if filtered { return "검색 결과 \(shown.count)건" }
        return shown.isEmpty ? "공론 중인 주제" : "공론 중인 주제 \(shown.count)건"
    }

    @ViewBuilder
    private var content: some View {
        switch mode {
        case .card:
            ForEach(shown, id: \.policy.id) { PolicyCardRow(summary: $0) }
        case .list:
            ForEach(shown, id: \.policy.id) { PolicyLineRow(summary: $0) }
        case .section:
            // Dictionary 는 순서가 없으므로 분류 순서를 따로 준다.
            ForEach(categories, id: \.value) { item in
                let group = shown.filter { $0.policy.category == item.value }
                if !group.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(item.label)  \(group.count)").font(.subheadline.bold())
                        Divider()
                    }
                    .padding(.top, 6)
                    ForEach(group, id: \.policy.id) { PolicyLineRow(summary: $0) }
                }
            }
        }
    }
}

private struct Chip: View {
    let label: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.footnote)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(on ? Color.accentColor : Color.secondary.opacity(0.15),
                            in: Capsule())
                .foregroundStyle(on ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }
}

/// 정렬·보기 선택. 항목이 적어 드롭다운 대신 칩으로 둔다 — 한 번에 다 보인다.
private struct ChoiceRow<Option: Hashable & Identifiable>: View {
    let title: String
    let options: [Option]
    @Binding var selected: Option
    let label: (Option) -> String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                ForEach(options) { option in
                    Chip(label: label(option), on: option == selected) { selected = option }
                }
            }
        }
    }
}

struct PolicyCardRow: View {
    let summary: PolicySummary

    var body: some View {
        NavigationLink {
            DetailView(policyId: summary.policy.id)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(summary.policy.title).font(.headline)
                    Spacer()
                    Text(ago(summary.lastActivityAt)).font(.caption).foregroundStyle(.secondary)
                }
                Text(meta).font(.caption).foregroundStyle(.secondary)
                Text(summary.policy.coreQuestion).font(.subheadline)
                DistributionBar(summary: summary)
                HStack(spacing: 8) {
                    Text(counts).font(.caption).foregroundStyle(.secondary)
                    if needsBalance(summary) {
                        // 쏠린 주제에 참여를 권한다. 반대편 의견을 데려오는 것이
                        // 목적이므로 목록에서부터 그 일을 한다.
                        Text("⚖ \(summary.supportCount > summary.opposeCount ? "반대" : "찬성") 의견이 필요해요")
                            .font(.caption)
                            .foregroundStyle(Color(red: 0xD9 / 255, green: 0xA4 / 255, blue: 0x41 / 255))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private var meta: String {
        let agency = summary.policy.targetAgency.flatMap { $0.isEmpty ? nil : " · \($0)" } ?? ""
        return categoryLabel(summary.policy.category) + agency
    }

    private var counts: String {
        let total = opinionTotal(summary)
        let base = "찬성 \(summary.supportCount) · 대안 \(summary.alternativeCount) · 반대 \(summary.opposeCount)"
        return total > 0 ? base + " · 의견 \(total)건" : base
    }
}

/// 목록 보기 — 한 줄로 촘촘하게. 훑을 때는 한 화면에 많이 보이는 편이 낫다.
struct PolicyLineRow: View {
    let summary: PolicySummary

    var body: some View {
        NavigationLink {
            DetailView(policyId: summary.policy.id)
        } label: {
            HStack(spacing: 10) {
                Text(summary.policy.title).font(.subheadline).lineLimit(1)
                Spacer()
                DistributionBar(summary: summary).frame(width: 72)
                Text("\(opinionTotal(summary))건").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

/// 찬반 분포 막대. 가운데가 대안이다.
struct DistributionBar: View {
    let summary: PolicySummary

    var body: some View {
        GeometryReader { geometry in
            let total = opinionTotal(summary)
            HStack(spacing: 0) {
                if total > 0 {
                    ForEach(parts) { part in
                        if part.count > 0 {
                            stanceColor(part.stance)
                                .frame(width: geometry.size.width * CGFloat(part.count) / CGFloat(total))
                        }
                    }
                }
            }
            .frame(height: 8)
            .background(Color.secondary.opacity(0.2))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .frame(height: 8)
    }

    /// 튜플 대신 구조체를 쓴다. ForEach 가 튜플 원소를 분해해 주지 않는다.
    private struct Part: Identifiable {
        let stance: StanceType
        let count: Int
        var id: String { stanceLabel(stance) }
    }

    private var parts: [Part] {
        [Part(stance: .support, count: Int(summary.supportCount)),
         Part(stance: .alternative, count: Int(summary.alternativeCount)),
         Part(stance: .oppose, count: Int(summary.opposeCount))]
    }
}
