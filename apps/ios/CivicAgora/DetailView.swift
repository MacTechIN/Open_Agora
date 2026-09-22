import SwiftUI

/// 주제 상세 — 쟁점 질문, 의견, 의견 쓰기.
///
/// 웹과 Windows 는 찬성·대안·반대를 3열로 나란히 둔다. **어느 쪽도 우대하지
/// 않는다**는 것이 그 배치의 뜻이다. 휴대폰 너비에서는 3열이 읽히지 않으므로
/// 같은 뜻을 다른 수단으로 지킨다 — 세 입장을 같은 크기의 칩으로 두고,
/// 기본값을 「전체」로 해서 어느 한쪽을 먼저 보여주지 않는다.
/// Android 의 DetailScreen.kt 와 같은 방식이다.
struct DetailView: View {
    let policyId: String
    @EnvironmentObject private var model: AppModel
    @State private var stanceFilter: StanceType?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let summary = model.current, summary.policy.id == policyId {
                    header(summary)
                    Text("의견 \(model.opinions.count)건").font(.headline)
                    DistributionBar(summary: summary)
                    filterChips
                    opinionList
                    composer(summary)
                } else if model.busy {
                    ProgressView()
                }

                if let error = model.error { ErrorNotice(message: error) }
            }
            .padding(16)
        }
        .navigationTitle("주제")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadDetail(policyId: policyId) }
    }

    private func header(_ summary: PolicySummary) -> some View {
        let policy = summary.policy
        let agency = policy.targetAgency.flatMap { $0.isEmpty ? nil : " · \($0)" } ?? ""
        return VStack(alignment: .leading, spacing: 10) {
            Text(policy.title).font(.title3.bold())
            HStack {
                Text(categoryLabel(policy.category) + agency)
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                // 서명은 이 글이 올라온 뒤 바뀌지 않았다는 것만 말한다.
                let status = checkPolicy(policy: policy)
                Text(signatureText(status)).font(.caption).foregroundStyle(signatureColor(status))
            }
            Labeled("쟁점 질문") { Text(policy.coreQuestion).font(.subheadline.bold()) }
            Labeled("왜 지금 이슈인가") { Text(policy.background).font(.subheadline) }
            Text(policy.officialSourceUrl).font(.caption).foregroundStyle(.blue)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                StanceChip(label: "전체 \(model.opinions.count)", on: stanceFilter == nil) {
                    stanceFilter = nil
                }
                ForEach([StanceType.support, .alternative, .oppose], id: \.self) { stance in
                    let count = model.opinions.filter { $0.stance == stance }.count
                    let label = stance == .alternative ? "대안 · 합의" : stanceLabel(stance)
                    StanceChip(label: "\(label) \(count)", on: stanceFilter == stance) {
                        stanceFilter = stance
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var opinionList: some View {
        let shown = stanceFilter.map { wanted in model.opinions.filter { $0.stance == wanted } }
            ?? model.opinions
        if shown.isEmpty {
            Text("아직 없습니다. 첫 의견을 남겨보세요.")
                .font(.callout).foregroundStyle(.secondary)
        } else {
            ForEach(shown, id: \.id) { OpinionCard(card: $0) }
        }
    }

    private func composer(_ summary: PolicySummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("내 의견 남기기").font(.headline)
            Text(summary.policy.coreQuestion).font(.subheadline).foregroundStyle(.secondary)
            OpinionFormView(submitLabel: "의견 올리기", busy: model.busy) { draft in
                Task { await model.submitOpinion(policyId: policyId, draft: draft) }
            }
        }
        .padding(16)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct StanceChip: View {
    let label: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.footnote)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(on ? Color.accentColor : Color.secondary.opacity(0.15), in: Capsule())
                .foregroundStyle(on ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }
}

struct OpinionCard: View {
    let card: DebateCard

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(stanceLabel(card.stance))
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(stanceColor(card.stance), in: RoundedRectangle(cornerRadius: 4))
                Spacer()
                Text(formatTime(card.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
            Labeled("논점") { Text(card.problemDefinition).font(.subheadline) }
            Labeled("근거") { Text(card.evidenceSource).font(.subheadline) }
            Text(card.evidenceUrl).font(.caption).foregroundStyle(.blue)
            Labeled("제안") { Text(card.actionableSolution).font(.subheadline) }
            Divider()
            HStack {
                // 필명 체계는 VS-C3 에서 붙는다. 그때까지는 식별자 앞부분만 보인다.
                Text("작성자 \(shortenDid(card.authorDid))")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                let status = checkOpinion(card: card)
                Text(signatureText(status)).font(.caption).foregroundStyle(signatureColor(status))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private func formatTime(_ epochMillis: Int64) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: Double(epochMillis) / 1000))
    }
}

struct Labeled<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content

    init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
