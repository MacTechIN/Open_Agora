import SwiftUI

/// CivicAgora — 시민 공론장 (iOS).
///
/// 공유 API(open-agora.vercel.app)를 본다. 웹·Windows·Android 와 **같은
/// 광장**을 보여준다. 기기마다 다른 주제가 보이면 그것은 공론장이 아니다.
@main
struct CivicAgoraApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// 화면 상태를 한곳에 모은다. 화면이 넷뿐이라 라우터를 두지 않는다.
@MainActor
final class AppModel: ObservableObject {
    @Published var policies: [PolicySummary] = []
    @Published var current: PolicySummary?
    @Published var opinions: [DebateCard] = []
    @Published var busy = false
    @Published var error: String?
    @Published var memberStatus: String?
    @Published var codeSent = false
    /// 회원 여부. nil 이면 아직 확인하지 못했다는 뜻 — 확인 전에
    /// "등록하세요"를 띄우면 이미 회원인 사람을 헷갈리게 한다.
    @Published var isMember: Bool?

    let api = ApiClient()
    let identity: Result<DeviceIdentity.Identity, Error>

    init() {
        identity = Result { try DeviceIdentity.loadOrCreate() }
    }

    var did: String? { try? identity.get().did }

    /// 실패 문장은 서버가 보낸 것을 그대로 보여준다. 사용자가 고칠 수 있는 내용이다.
    ///
    /// 회원이 아니라서 막힌 것이면 오류로 끝내지 않고 길을 알려준다 —
    /// 기기를 바꾼 사람은 분명히 가입했는데 아니라고 하니 이유를 알 수 없다.
    private func fail(_ title: String, _ error: Error) {
        let message = error.localizedDescription
        if message.contains("시민 인증") {
            isMember = false
            self.error = nil
            return
        }
        self.error = "\(title)\n\(message)"
    }

    /// 이 기기가 회원인지 조용히 확인한다. 실패하면 아무것도 하지 않는다.
    func checkMembership() async {
        guard let did else { return }
        isMember = try? await api.isMember(did: did)
    }

    func loadPlaza() async {
        busy = true
        defer { busy = false }
        do {
            policies = try await api.listPolicies()
            error = nil
        } catch {
            fail("광장을 불러오지 못했습니다", error)
        }
    }

    func loadDetail(policyId: String) async {
        busy = true
        defer { busy = false }
        do {
            // 목록을 다시 읽어 요약(집계)을 갱신한다. 상세 전용 엔드포인트가
            // 요약을 주지 않으므로 여기서 맞춘다.
            policies = try await api.listPolicies()
            guard let summary = policies.first(where: { $0.policy.id == policyId }) else {
                error = "주제를 찾지 못했습니다"
                return
            }
            current = summary
            opinions = try await api.listOpinions(policyId: policyId)
            error = nil
        } catch {
            fail("주제를 불러오지 못했습니다", error)
        }
    }

    /// 글을 쓸 자격이 있는지 본다. 없으면 이유를 화면에 남긴다.
    private func requireDid() -> String? {
        guard let did else {
            error = "글을 쓰려면 시민 ID가 필요합니다. 「시민 인증」에서 확인해 주세요."
            return nil
        }
        return did
    }

    func submitOpinion(policyId: String, draft: DraftCard) async {
        guard let did = requireDid() else { return }
        busy = true
        do {
            _ = try await api.addOpinion(policyId: policyId, card: draft, authorDid: did)
            error = nil
        } catch {
            fail("의견을 올리지 못했습니다", error)
        }
        busy = false
        await loadDetail(policyId: policyId)
    }

    func submitTopic(policy: DraftPolicy, firstOpinion: DraftCard) async -> String? {
        guard let did = requireDid() else { return nil }
        busy = true
        defer { busy = false }
        do {
            let id = try await api.openPolicy(policy: policy, firstOpinion: firstOpinion, authorDid: did)
            error = nil
            return id
        } catch {
            fail("주제를 올리지 못했습니다", error)
            return nil
        }
    }

    func requestCode(email: String) async {
        busy = true
        defer { busy = false }
        do {
            try await api.requestCode(email: email)
            codeSent = true
            memberStatus = "인증코드를 보냈습니다. 메일함을 확인해 주세요."
            error = nil
        } catch {
            fail("인증코드를 보내지 못했습니다", error)
        }
    }

    func verify(email: String, code: String) async {
        guard let did else {
            error = "시민 ID를 만들지 못해 인증할 수 없습니다."
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await api.verify(email: email, code: code, did: did)
            codeSent = false
            isMember = true
            memberStatus = "인증이 끝났습니다. 이제 글을 쓸 수 있습니다."
            error = nil
        } catch {
            fail("인증에 실패했습니다", error)
        }
    }
}

struct RootView: View {
    @StateObject private var model = AppModel()

    var body: some View {
        NavigationStack {
            PlazaView()
                .navigationTitle("CivicAgora")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink("시민 인증") { MemberView() }
                    }
                    ToolbarItem(placement: .topBarLeading) {
                        NavigationLink("주제 올리기") { NewTopicView() }
                    }
                }
        }
        .environmentObject(model)
        .task {
            await model.loadPlaza()
            await model.checkMembership()
        }
    }
}

/// 오류 알림. 서버가 보낸 안내를 그대로 보여준다.
struct ErrorNotice: View {
    let message: String
    var body: some View {
        Text(message)
            .font(.callout)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }
}


/**
 * 기기 등록이 필요하다는 안내 (D21).
 *
 * 왜 그런지까지 적습니다. 기기를 바꾼 사람은 분명히 가입했는데 아니라고 하니
 * 이유를 알 수 없고, 이유를 모르면 고장으로 봅니다.
 */
struct MemberNotice: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("이 기기를 먼저 등록해 주세요").font(.subheadline.bold())
            Text("시민 ID는 기기 안에서 만들어지고 기기 밖으로 나오지 않습니다. "
                 + "이미 인증하셨더라도 같은 이메일로 다시 인증하면 이 기기가 추가됩니다.")
                .font(.caption).foregroundStyle(.secondary)
            NavigationLink("이 기기 등록하기") { MemberView() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}
