import SwiftUI

/// 주제 올리기.
///
/// 주제만 던지고 빠지는 것을 막기 위해 첫 의견을 함께 받는다. 둘은 서버에서
/// 한 트랜잭션으로 처리된다(core/src/store.rs open_policy).
struct NewTopicView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var category: PolicyCategory = .govPolicy
    @State private var background = ""
    @State private var question = ""
    @State private var sourceUrl = ""
    @State private var agency = ""

    // 주제 쪽이 덜 찼으면 의견 폼의 등록 버튼도 눌리지 않게 한다. 의견만
    // 다 쓰고 눌렀다가 거부당하는 일을 막는다.
    private var policyReady: Bool {
        (1...Limits.title).contains(countGraphemes(title))
            && (1...Limits.background).contains(countGraphemes(background))
            && (1...Limits.coreQuestion).contains(countGraphemes(question))
            && !sourceUrl.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("무엇을 공론화하려 하시나요?").font(.headline)

                    CountedField(label: "주제 제목", text: $title, limit: Limits.title,
                                 prompt: "예) 탄력 근로제 직종별 차등 적용")

                    VStack(alignment: .leading, spacing: 4) {
                        Text("분류").font(.caption).foregroundStyle(.secondary)
                        Picker("분류", selection: $category) {
                            ForEach(categories, id: \.value) { item in
                                Text(item.label).tag(item.value)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    CountedField(label: "왜 지금 이슈인가요?", text: $background, limit: Limits.background,
                                 prompt: "예) 최근 개정안이 발의되면서 업종별 적용 기준을 두고 노사 간 이견이 커지고 있습니다.")

                    VStack(alignment: .leading, spacing: 4) {
                        CountedField(label: "쟁점 질문", text: $question, limit: Limits.coreQuestion,
                                     prompt: "예) 직종별로 탄력 근로제 적용 기준을 달리해야 하는가?")
                        Text("찬성과 반대가 갈릴 수 있는 하나의 질문으로 적어주세요. 이 질문이 토론의 축이 됩니다.")
                            .font(.caption).foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("공식 출처 링크").font(.caption).foregroundStyle(.secondary)
                        TextField("https://likms.assembly.go.kr/...", text: $sourceUrl)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                        Text("법령, 의안, 보도자료 같은 1차 자료를 적어주세요.")
                            .font(.caption).foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("소관 기관 (선택)").font(.caption).foregroundStyle(.secondary)
                        TextField("예) 고용노동부", text: $agency)
                            .textFieldStyle(.roundedBorder)
                    }
                }
                .padding(16)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 12) {
                    Text("이 질문에 대한 내 입장").font(.headline)
                    Text("주제를 여는 분도 자기 의견을 함께 남깁니다. 토론이 빈 상태로 시작하지 않도록 하기 위해서입니다.")
                        .font(.caption).foregroundStyle(.secondary)
                    if !policyReady {
                        Text("위의 주제 항목을 먼저 채워주세요.")
                            .font(.caption).foregroundStyle(.red)
                    }
                    OpinionFormView(
                        submitLabel: "주제 올리기",
                        enabled: policyReady,
                        busy: model.busy
                    ) { opinion in
                        let policy = DraftPolicy(
                            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                            category: category,
                            background: background.trimmingCharacters(in: .whitespacesAndNewlines),
                            coreQuestion: question.trimmingCharacters(in: .whitespacesAndNewlines),
                            officialSourceUrl: sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                            targetAgency: agency.trimmingCharacters(in: .whitespacesAndNewlines)
                                .isEmpty ? nil : agency.trimmingCharacters(in: .whitespacesAndNewlines)
                        )
                        Task {
                            if await model.submitTopic(policy: policy, firstOpinion: opinion) != nil {
                                // 올린 뒤 광장으로 돌아간다. 새로 연 주제는
                                // 목록 맨 위에 있다.
                                await model.loadPlaza()
                                dismiss()
                            }
                        }
                    }
                }
                .padding(16)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))

                if let error = model.error { ErrorNotice(message: error) }
            }
            .padding(16)
        }
        .navigationTitle("주제 올리기")
        .navigationBarTitleDisplayMode(.inline)
    }
}
