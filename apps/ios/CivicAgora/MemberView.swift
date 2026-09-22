import SwiftUI

/// 시민 인증.
///
/// 이메일로 한 번 확인하고 나면 **회원 자격만 남는다.** 어떤 글이 누구의
/// 것인지는 서버에 저장하지 않는다. 지금은 확인 시점에 서버가 이메일과 DID 를
/// 함께 보므로 그 순간만큼은 연결이 가능하다 — 이 마지막 연결을 끊는 것이
/// VS-C3(ZK-Email)이다. 사실대로 적어 둔다.
///
/// 코드를 화면에 표시하지 않는다. 응답에 코드가 담기면 남의 이메일로 가입할
/// 수 있게 된다.
struct MemberView: View {
    @EnvironmentObject private var model: AppModel
    @State private var email = ""
    @State private var code = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("글을 쓰려면 이메일 인증이 한 번 필요합니다. 한 이메일로 한 사람만 가입할 수 있습니다.")
                        .font(.subheadline)
                    Text("인증이 끝나면 회원 자격만 남습니다. 어떤 글이 누구의 것인지는 저장하지 않습니다.")
                        .font(.caption).foregroundStyle(.secondary)

                    TextField("name@example.com", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)

                    Button {
                        Task { await model.requestCode(email: email.trimmingCharacters(in: .whitespaces)) }
                    } label: {
                        Text("인증코드 받기").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.busy || email.trimmingCharacters(in: .whitespaces).isEmpty)

                    if model.codeSent {
                        // 여섯 자리를 넘겨 받지 않는다. onChange 의 두 인자
                        // 형태는 iOS 17 부터라 바인딩에서 자른다.
                        TextField("000000", text: Binding(
                            get: { code },
                            set: { code = String($0.prefix(6)) }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                        Button {
                            Task {
                                await model.verify(
                                    email: email.trimmingCharacters(in: .whitespaces),
                                    code: code.trimmingCharacters(in: .whitespaces)
                                )
                            }
                        } label: {
                            Text("인증 완료하기").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.busy || code.count != 6)
                    }

                    if let status = model.memberStatus {
                        Text(status).font(.subheadline)
                    }
                    if let error = model.error { ErrorNotice(message: error) }
                }
                .padding(16)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 8) {
                    Text("내 시민 ID").font(.headline)
                    switch model.identity {
                    case .success(let identity):
                        Text(identity.did).font(.caption.monospaced()).textSelection(.enabled)
                        Text(identity.protection.label).font(.caption).foregroundStyle(.secondary)
                    case .failure(let error):
                        Text("시민 ID를 만들지 못했습니다: \(error.localizedDescription)")
                            .font(.caption).foregroundStyle(.red)
                    }
                    let info = coreInfo()
                    Text("CivicAgora \(info.version) (명세 rev \(info.specRevision)) · \(info.target)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(16)
        }
        .navigationTitle("시민 인증")
        .navigationBarTitleDisplayMode(.inline)
    }
}
