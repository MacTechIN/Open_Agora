import Foundation

/// 공유 API 클라이언트.
///
/// **전송만 담당한다.** 요청 본문 생성과 응답 파싱은 코어가 한다
/// (core/src/api.rs). 세 플랫폼이 각자 JSON 을 조립하면 필드가 어긋나고,
/// 그 버그는 서버 로그에서만 보인다.
///
/// HTTP 를 플랫폼에 맡기는 이유는 OS 의 프록시·인증서 정책을 그대로 쓰기
/// 위해서다. Rust 에 TLS 를 넣으면 그것을 잃고 크로스 컴파일 위험도 커진다.
///
/// Windows 의 ApiClient.cs, Android 의 ApiClient.kt 와 같은 메서드를 같은
/// 순서로 둔다. 한쪽에만 있는 호출이 생기면 세 앱이 다른 서비스가 된다.
actor ApiClient {

    /// 공론장 주소.
    ///
    /// 상수로 두는 이유는 앱이 임의의 서버를 가리키게 만드는 설정 화면을
    /// 두지 않기 위해서다 — 그런 화면은 피싱 경로가 된다.
    static let defaultBaseURL = "https://open-agora.vercel.app"

    /// 통신 실패. 사용자에게 그대로 보여줄 수 있는 문장을 담는다.
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private let base: String
    private let session: URLSession

    init(baseURL: String = ApiClient.defaultBaseURL) {
        self.base = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        let config = URLSessionConfiguration.default
        // 무응답 서버에 무한정 기다리면 앱이 멈춘 것처럼 보인다.
        config.timeoutIntervalForRequest = 20
        self.session = URLSession(configuration: config)
    }

    private func send(_ method: String, _ path: String, body: String? = nil) async throws -> String {
        guard let url = URL(string: base + path) else {
            throw Failure(message: "주소를 만들지 못했습니다: \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.httpBody = Data(body.utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            // 연결 실패와 서버 오류를 구분한다. 사용자가 할 일이 다르다.
            throw Failure(message: """
                공론장에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.
                (\(error.localizedDescription))
                """)
        }

        let text = String(decoding: data, as: UTF8.self)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let ok = (200..<300).contains(status)
        // 4xx 는 본문에 사용자용 안내가 들어 있다. 코어가 꺼내 쓰도록 그대로 넘긴다.
        if !ok && text.isEmpty {
            throw Failure(message: "서버가 응답하지 않았습니다 (\(status))")
        }
        return text
    }

    /// 광장 목록.
    func listPolicies() async throws -> [PolicySummary] {
        try parsePolicies(json: await send("GET", "/api/policies"))
    }

    /// 한 주제의 의견 전부.
    func listOpinions(policyId: String) async throws -> [DebateCard] {
        try parseOpinions(json: await send("GET", "/api/policies/\(policyId)"))
    }

    /// 주제를 열고 첫 의견을 함께 등록한다.
    ///
    /// 보내기 전에 기기 키로 서명한다(VS-A4). 서버가 글을 고치면 이 서명이
    /// 깨지므로 고친 사실이 드러난다.
    func openPolicy(policy: DraftPolicy, firstOpinion: DraftCard, authorDid: String) async throws -> String {
        // 시각을 여기서 정한다. 서명이 시각을 덮으려면 서명하는 쪽이 그 값을
        // 알아야 하기 때문이다. 서버가 정하면 서버가 시각을 바꿔도 검증이 통과한다.
        let createdAt = Int64(Date().timeIntervalSince1970 * 1000)

        // 서명 대상 바이트는 코어가 만든다. 플랫폼이 각자 조립하면 바이트 한
        // 칸이 어긋나고, 그 버그는 검증 실패로만 나타나 원인을 찾기 어렵다.
        let policySignature = try DeviceIdentity.sign(
            message: try policySigningPayload(policy: policy, authorDid: authorDid, createdAt: createdAt)
        )

        // 첫 의견의 서명은 주제 식별자를 덮어야 한다. 그러지 않으면 같은
        // 서명을 다른 주제에 옮겨 붙일 수 있다.
        let id = try policyId(policy: policy, authorDid: authorDid, createdAt: createdAt)
        let opinionSignature = try DeviceIdentity.sign(
            message: try opinionSigningPayload(
                policyId: id, card: firstOpinion, authorDid: authorDid, createdAt: createdAt)
        )

        // 보내기 전에 코어가 검증한다. 왕복 없이 알려주는 편이 낫고,
        // 네트워크가 없을 때도 입력 문제를 알 수 있다.
        let body = try openPolicyBody(
            policy: policy, firstOpinion: firstOpinion, authorDid: authorDid,
            createdAt: createdAt, policySignature: policySignature,
            opinionSignature: opinionSignature)
        return try parseId(json: await send("POST", "/api/policies", body: body))
    }

    /// 기존 주제에 의견을 추가한다. 보내기 전에 서명한다.
    func addOpinion(policyId: String, card: DraftCard, authorDid: String) async throws -> String {
        let createdAt = Int64(Date().timeIntervalSince1970 * 1000)
        let signature = try DeviceIdentity.sign(
            message: try opinionSigningPayload(
                policyId: policyId, card: card, authorDid: authorDid, createdAt: createdAt)
        )
        let body = try addOpinionBody(
            card: card, authorDid: authorDid, createdAt: createdAt, signature: signature)
        return try parseId(json: await send("POST", "/api/policies/\(policyId)/opinions", body: body))
    }

    /// 인증코드를 요청한다.
    func requestCode(email: String) async throws {
        try throwIfError(await send("POST", "/api/auth/request", body: encode(["email": email])))
    }

    /// 코드를 확인하고 시민으로 등록한다.
    func verify(email: String, code: String, did: String) async throws {
        let body = encode(["email": email, "code": code, "did": did])
        try throwIfError(await send("POST", "/api/auth/verify", body: body))
    }

    private func encode(_ fields: [String: String]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: fields)) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// 인증 응답의 오류를 꺼낸다.
    ///
    /// 주제·의견 응답은 코어가 오류를 꺼내지만, 인증 응답은 코어를 거치지
    /// 않으므로 여기서 본다.
    private func throwIfError(_ json: String) throws {
        guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)),
              let dictionary = object as? [String: Any] else {
            throw Failure(message: "서버 응답을 읽지 못했습니다")
        }
        if let message = dictionary["error"] as? String {
            throw Failure(message: message)
        }
    }
}
