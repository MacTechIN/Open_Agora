import SwiftUI

/// 의견 작성 폼 (3단 구조화 입력).
///
/// 입장에 따라 **묻는 말이 바뀐다.** 찬성하는 사람에게 "무엇이 문제인가"를
/// 묻는 것은 답할 수 없는 질문이다. 저장되는 필드의 의미(논점·근거·제안)와
/// 길이 제한은 고정이고 화면 문구만 바뀐다.
///
/// 명세: docs/00_PRODUCT_SPEC.md §3.1 · 결정: D17
/// Windows 의 OpinionForm.cs, Android 의 OpinionForm.kt 와 문구가 같아야 한다.
///
/// 단일 텍스트 박스를 쓰지 않는 이유는 감정적 선동을 억제하기 위해서다.
/// 세 필드가 모두 필수이며 합계 500자다.
struct OpinionFormView: View {
    let submitLabel: String
    var enabled: Bool = true
    let busy: Bool
    let onSubmit: (DraftCard) -> Void

    @State private var stance: StanceType = .support
    @State private var problem = ""
    @State private var evidence = ""
    @State private var url = ""
    @State private var solution = ""

    /// 입장별 질문. 첫 번째가 ①, 두 번째가 ③ 이다.
    /// ② 근거는 입장과 무관하게 같다.
    private var questions: (String, String) {
        switch stance {
        case .support: return ("① 왜 이 방향이 옳다고 보시나요?", "③ 잘 되려면 무엇이 필요할까요?")
        case .alternative: return ("① 어떤 점이 아쉬운가요?", "③ 어떤 대안을 제안하시나요?")
        case .oppose: return ("① 무엇이 문제인가요?", "③ 대신 어떻게 하면 좋을까요?")
        }
    }

    // 한도를 넘으면 버튼 자체를 막는다. 코어가 다시 검증하지만, 보낸 뒤에
    // 거부당하는 것보다 미리 막는 편이 낫다.
    private var ready: Bool {
        !busy && enabled
            && (1...Limits.problem).contains(countGraphemes(problem))
            && (1...Limits.evidence).contains(countGraphemes(evidence))
            && (1...Limits.solution).contains(countGraphemes(solution))
            && !url.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// 톤 스크리닝 (VS-E1).
    ///
    /// **기기 안에서만 돕니다.** 코어를 부를 뿐 네트워크를 쓰지 않습니다 —
    /// 쓰다 만 말은 쓴 말보다 사람을 더 많이 드러냅니다.
    ///
    /// 세 본문 칸을 함께 보고 한 줄만 띄웁니다. 칸마다 띄우면 잔소리가 되고,
    /// 잔소리가 되면 읽지 않습니다.
    ///
    /// 스크리닝이 실패해도 글쓰기를 막지 않습니다 — 코치가 고장 났다고
    /// 사용자가 글을 못 쓸 이유는 없습니다.
    private var rough: Bool {
        screen(text: "\(problem)\n\(evidence)\n\(solution)").needsReview
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("어떤 입장이신가요?").font(.subheadline.bold())
            // 찬성과 반대를 시각적으로 동등하게 둔다. 순서상 대안이 가운데다.
            Picker("입장", selection: $stance) {
                Text("찬성").tag(StanceType.support)
                Text("대안 제시").tag(StanceType.alternative)
                Text("반대").tag(StanceType.oppose)
            }
            .pickerStyle(.segmented)

            CountedField(
                label: questions.0,
                text: $problem,
                limit: Limits.problem,
                prompt: "예) 현행 제도가 모든 업종에 똑같이 적용되어 소상공인에게 과도한 행정 부담을 줍니다."
            )

            CountedField(
                label: "② 어떤 근거가 있나요?",
                text: $evidence,
                limit: Limits.evidence,
                prompt: "예) 통계청 2026년 사업체노동력조사에서 5인 미만 사업장의 행정 부담이 가장 높게 나타났습니다."
            )

            VStack(alignment: .leading, spacing: 4) {
                Text("근거 자료의 출처 링크").font(.caption).foregroundStyle(.secondary)
                TextField("https://kostat.go.kr/...", text: $url)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Text("통계청, 정부 고시, 국회 의안, 학술 논문 같은 1차 자료를 권합니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            CountedField(
                label: questions.1,
                text: $solution,
                limit: Limits.solution,
                prompt: "예) 업종별로 기준을 나누고, 소규모 사업장에는 신고 절차를 간소화합니다."
            )

            if rough {
                // 점수도 걸린 표현도 보여주지 않습니다. 점수를 보여주면 점수를
                // 낮추는 글쓰기를 하게 되고, 걸린 표현을 보여주면 그것을 피해
                // 쓰는 법을 알려 주는 셈이 됩니다.
                //
                // **막지 않습니다.** 아래 등록 버튼은 그대로입니다.
                Text("거친 표현이 섞여 있을 수 있습니다. 그대로 올리셔도 됩니다 — "
                     + "다만 논거가 표현에 가려지면 반대편이 읽지 않습니다.")
                    .font(.caption)
                    .foregroundStyle(Color(red: 0xD9 / 255, green: 0xA4 / 255, blue: 0x41 / 255))
            }

            Button {
                onSubmit(DraftCard(
                    stance: stance,
                    problemDefinition: problem.trimmingCharacters(in: .whitespacesAndNewlines),
                    evidenceSource: evidence.trimmingCharacters(in: .whitespacesAndNewlines),
                    evidenceUrl: url.trimmingCharacters(in: .whitespacesAndNewlines),
                    actionableSolution: solution.trimmingCharacters(in: .whitespacesAndNewlines)
                ))
                // 보낸 뒤 비운다. 입장은 유지한다 — 같은 입장으로 연달아 쓰는
                // 경우가 많다.
                problem = ""; evidence = ""; url = ""; solution = ""
            } label: {
                Text(busy ? "올리는 중…" : submitLabel)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!ready)

            Text("올린 글은 수정하거나 지울 수 없습니다.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// 글자 수를 함께 보여주는 여러 줄 입력.
struct CountedField: View {
    let label: String
    @Binding var text: String
    let limit: Int
    let prompt: String

    var body: some View {
        let count = countGraphemes(text)
        let over = count > limit
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.bold())
            TextField(prompt, text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
            Text(
                // 넘긴 만큼을 알려준다. 한도만 보여주면 얼마나 줄여야 할지 알 수 없다.
                over ? "\(count) / \(limit)자 — \(count - limit)자 초과" : "\(count) / \(limit)자"
            )
            .font(.caption)
            .foregroundStyle(over ? Color.red : Color.secondary)
        }
    }
}
