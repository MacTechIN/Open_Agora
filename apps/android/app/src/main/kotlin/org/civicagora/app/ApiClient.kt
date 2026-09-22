package org.civicagora.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.civicagora.core.DebateCard
import org.civicagora.core.DraftCard
import org.civicagora.core.DraftPolicy
import org.civicagora.core.PolicySummary
import org.civicagora.core.addOpinionBody
import org.civicagora.core.openPolicyBody
import org.civicagora.core.opinionSigningPayload
import org.civicagora.core.parseId
import org.civicagora.core.policyId as corePolicyId
import org.civicagora.core.policySigningPayload
import org.civicagora.core.parseOpinions
import org.civicagora.core.parsePolicies
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 공유 API 클라이언트.
 *
 * **전송만 담당한다.** 요청 본문 생성과 응답 파싱은 코어가 한다
 * (core/src/api.rs). 두 플랫폼이 각자 JSON 을 조립하면 필드가 어긋나고,
 * 그 버그는 서버 로그에서만 보인다.
 *
 * HTTP 를 플랫폼에 맡기는 이유는 OS 의 프록시·인증서 정책을 그대로 쓰기
 * 위해서다. Rust 에 TLS 를 넣으면 그것을 잃고 크로스 컴파일 위험도 커진다.
 *
 * Windows 의 ApiClient.cs 와 같은 메서드를 같은 순서로 둔다. 한쪽에만 있는
 * 호출이 생기면 두 앱이 다른 서비스가 된다.
 */
class ApiClient(baseUrl: String = DEFAULT_BASE_URL) {

    private val base = baseUrl.trimEnd('/')

    /** 통신 실패. 사용자에게 그대로 보여줄 수 있는 문장을 담는다. */
    class Failure(message: String) : Exception(message)

    private suspend fun send(method: String, path: String, body: String? = null): String =
        withContext(Dispatchers.IO) {
            val connection = URL(base + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = method
                // 무응답 서버에 무한정 기다리면 앱이 멈춘 것처럼 보인다.
                connection.connectTimeout = 20_000
                connection.readTimeout = 20_000
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }

                val code = connection.responseCode
                val ok = code in 200..299
                // 4xx 는 본문에 사용자용 안내가 들어 있다. 코어가 꺼내 쓰도록
                // 그대로 넘긴다. errorStream 을 읽지 않으면 그 안내를 잃는다.
                val stream = if (ok) connection.inputStream else connection.errorStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                if (!ok && text.isEmpty()) {
                    throw Failure("서버가 응답하지 않았습니다 ($code)")
                }
                text
            } catch (failure: Failure) {
                throw failure
            } catch (e: Exception) {
                // 연결 실패와 서버 오류를 구분한다. 사용자가 할 일이 다르다.
                throw Failure("공론장에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.\n(${e.message})")
            } finally {
                connection.disconnect()
            }
        }

    /** 광장 목록. */
    suspend fun listPolicies(): List<PolicySummary> = parsePolicies(send("GET", "/api/policies"))

    /** 한 주제의 의견 전부. */
    suspend fun listOpinions(policyId: String): List<DebateCard> =
        parseOpinions(send("GET", "/api/policies/$policyId"))

    /**
     * 주제를 열고 첫 의견을 함께 등록한다.
     *
     * 보내기 전에 기기 키로 서명한다(VS-A4). 서버가 글을 고치면 이 서명이
     * 깨지므로 고친 사실이 드러난다.
     */
    suspend fun openPolicy(policy: DraftPolicy, firstOpinion: DraftCard, authorDid: String): String {
        // 시각을 여기서 정한다. 서명이 시각을 덮으려면 서명하는 쪽이 그 값을
        // 알아야 하기 때문이다. 서버가 정하면 서버가 시각을 바꿔도 검증이 통과한다.
        val createdAt = System.currentTimeMillis()

        // 서명 대상 바이트는 코어가 만든다. 플랫폼이 각자 조립하면 바이트 한
        // 칸이 어긋나고, 그 버그는 검증 실패로만 나타나 원인을 찾기 어렵다.
        val policySignature = withContext(Dispatchers.IO) {
            // StrongBox 서명은 100ms 가까이 걸릴 수 있다. 주 스레드에서 하면
            // 버튼을 누른 순간 화면이 멈춘 것처럼 보인다.
            DeviceIdentity.sign(policySigningPayload(policy, authorDid, createdAt))
        }

        // 첫 의견의 서명은 주제 식별자를 덮어야 한다. 그러지 않으면 같은
        // 서명을 다른 주제에 옮겨 붙일 수 있다.
        val id = corePolicyId(policy, authorDid, createdAt)
        val opinionSignature = withContext(Dispatchers.IO) {
            DeviceIdentity.sign(opinionSigningPayload(id, firstOpinion, authorDid, createdAt))
        }

        // 보내기 전에 코어가 검증한다. 왕복 없이 알려주는 편이 낫고,
        // 네트워크가 없을 때도 입력 문제를 알 수 있다.
        val body = openPolicyBody(
            policy, firstOpinion, authorDid, createdAt, policySignature, opinionSignature
        )
        return parseId(send("POST", "/api/policies", body))
    }

    /** 기존 주제에 의견을 추가한다. 보내기 전에 서명한다. */
    suspend fun addOpinion(policyId: String, card: DraftCard, authorDid: String): String {
        val createdAt = System.currentTimeMillis()
        val signature = withContext(Dispatchers.IO) {
            DeviceIdentity.sign(opinionSigningPayload(policyId, card, authorDid, createdAt))
        }
        val body = addOpinionBody(card, authorDid, createdAt, signature)
        return parseId(send("POST", "/api/policies/$policyId/opinions", body))
    }

    /** 인증코드를 요청한다. */
    suspend fun requestCode(email: String) {
        val body = JSONObject().put("email", email).toString()
        throwIfError(send("POST", "/api/auth/request", body))
    }

    /** 코드를 확인하고 시민으로 등록한다. */
    suspend fun verify(email: String, code: String, did: String) {
        val body = JSONObject().put("email", email).put("code", code).put("did", did).toString()
        throwIfError(send("POST", "/api/auth/verify", body))
    }

    /**
     * 인증 응답의 오류를 꺼낸다.
     *
     * 주제·의견 응답은 코어가 오류를 꺼내지만, 인증 응답은 코어를 거치지
     * 않으므로 여기서 본다.
     */
    private fun throwIfError(json: String) {
        val document = try {
            JSONObject(json)
        } catch (e: Exception) {
            throw Failure("서버 응답을 읽지 못했습니다")
        }
        if (document.has("error")) {
            throw Failure(document.optString("error", "요청을 처리하지 못했습니다"))
        }
    }

    companion object {
        /**
         * 공론장 주소.
         *
         * 로컬 서버로 시험할 때는 빌드에서 바꾼다. 상수로 두는 이유는
         * 앱이 임의의 서버를 가리키게 만드는 설정 화면을 두지 않기
         * 위해서다 — 그런 화면은 피싱 경로가 된다.
         */
        const val DEFAULT_BASE_URL = "https://open-agora.vercel.app"
    }
}
