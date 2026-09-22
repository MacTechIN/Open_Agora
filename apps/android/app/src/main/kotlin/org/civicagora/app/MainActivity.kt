package org.civicagora.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.civicagora.core.DebateCard
import org.civicagora.core.PolicySummary
import org.civicagora.core.coreInfo

/**
 * CivicAgora — 시민 공론장.
 *
 * 공유 API(https://open-agora.vercel.app)를 본다. 웹·Windows 와 **같은 광장**을
 * 보여준다. 기기마다 다른 주제가 보이면 그것은 공론장이 아니다.
 *
 * 로컬 SQLite(CardStore)는 더 이상 쓰지 않는다. 혼자만 보는 카드는 공론이
 * 아니었다. 코어는 이제 검증과 JSON 코덱을 맡고, 저장은 서버가 한다.
 *
 * 화면이 넷뿐이고 상태를 여기서 들고 있으므로 Navigation 라이브러리를 쓰지
 * 않는다. 의존성 하나가 늘면 빌드가 깨질 자리도 하나 늘어난다.
 */
private enum class Screen { PLAZA, DETAIL, NEW_TOPIC, MEMBER }

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Result 는 인라인 클래스라 lateinit 프로퍼티로 둘 수 없다.
        // onCreate 지역 변수로 만들어 컴포지션에 넘긴다.
        val identity = runCatching { DeviceIdentity.loadOrCreate() }

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    App(identity)
                }
            }
        }
    }
}

@Composable
private fun App(identity: Result<DeviceIdentity.Identity>) {
    val api = remember { ApiClient() }
    val scope = rememberCoroutineScope()

    var screen by remember { mutableStateOf(Screen.PLAZA) }
    var policies by remember { mutableStateOf<List<PolicySummary>>(emptyList()) }
    var current by remember { mutableStateOf<PolicySummary?>(null) }
    var opinions by remember { mutableStateOf<List<DebateCard>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var memberStatus by remember { mutableStateOf<String?>(null) }
    var codeSent by remember { mutableStateOf(false) }

    /** 실패 문장은 서버가 보낸 것을 그대로 보여준다. 사용자가 고칠 수 있는 내용이다. */
    fun reason(e: Throwable): String = e.message ?: e::class.java.simpleName

    suspend fun loadPlaza() {
        busy = true
        runCatching { api.listPolicies() }
            .onSuccess { policies = it; error = null }
            .onFailure { error = "광장을 불러오지 못했습니다\n${reason(it)}" }
        busy = false
    }

    suspend fun loadDetail(policyId: String) {
        busy = true
        runCatching {
            // 목록을 다시 읽어 요약(집계)을 갱신한다. 상세 전용 엔드포인트가
            // 요약을 주지 않으므로 여기서 맞춘다.
            val summary = api.listPolicies().also { policies = it }
                .firstOrNull { it.policy.id == policyId }
                ?: throw ApiClient.Failure("주제를 찾지 못했습니다")
            summary to api.listOpinions(policyId)
        }.onSuccess { (summary, list) ->
            current = summary
            opinions = list
            error = null
        }.onFailure { error = "주제를 불러오지 못했습니다\n${reason(it)}" }
        busy = false
    }

    LaunchedEffect(Unit) { loadPlaza() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("CivicAgora", style = MaterialTheme.typography.headlineSmall)
        Text(
            "정책을 함께 검증하는 시민 공론장",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            NavButton("광장", screen == Screen.PLAZA) { screen = Screen.PLAZA }
            NavButton("주제 올리기", screen == Screen.NEW_TOPIC) { screen = Screen.NEW_TOPIC }
            NavButton("시민 인증", screen == Screen.MEMBER) { screen = Screen.MEMBER }
            TextButton(onClick = { scope.launch { loadPlaza() } }, enabled = !busy) {
                Text("새로고침")
            }
        }

        if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }

        when (screen) {
            Screen.PLAZA -> PlazaScreen(
                policies = policies,
                onOpen = { id -> screen = Screen.DETAIL; scope.launch { loadDetail(id) } },
            )

            Screen.DETAIL -> {
                TextButton(onClick = { screen = Screen.PLAZA }) { Text("← 광장으로") }
                current?.let { summary ->
                    DetailScreen(
                        summary = summary,
                        opinions = opinions,
                        busy = busy,
                        onSubmit = { draft ->
                            val did = identity.getOrNull()?.did
                            if (did == null) {
                                error = "글을 쓰려면 시민 ID가 필요합니다. 「시민 인증」에서 확인해 주세요."
                            } else scope.launch {
                                busy = true
                                runCatching { api.addOpinion(summary.policy.id, draft, did) }
                                    .onFailure { error = "의견을 올리지 못했습니다\n${reason(it)}" }
                                    .onSuccess { error = null }
                                busy = false
                                loadDetail(summary.policy.id)
                            }
                        },
                    )
                }
            }

            Screen.NEW_TOPIC -> {
                TextButton(onClick = { screen = Screen.PLAZA }) { Text("← 광장으로") }
                NewTopicScreen(
                    busy = busy,
                    onSubmit = { policy, firstOpinion ->
                        val did = identity.getOrNull()?.did
                        if (did == null) {
                            error = "글을 쓰려면 시민 ID가 필요합니다. 「시민 인증」에서 확인해 주세요."
                        } else scope.launch {
                            busy = true
                            runCatching { api.openPolicy(policy, firstOpinion, did) }
                                .onSuccess { id ->
                                    error = null
                                    screen = Screen.DETAIL
                                    busy = false
                                    loadDetail(id)
                                }
                                .onFailure {
                                    error = "주제를 올리지 못했습니다\n${reason(it)}"
                                    busy = false
                                }
                        }
                    },
                )
            }

            Screen.MEMBER -> {
                TextButton(onClick = { screen = Screen.PLAZA }) { Text("← 광장으로") }
                MemberScreen(
                    identity = identity,
                    info = remember { coreInfo() },
                    busy = busy,
                    status = memberStatus,
                    codeSent = codeSent,
                    onRequestCode = { email ->
                        scope.launch {
                            busy = true
                            runCatching { api.requestCode(email) }
                                .onSuccess {
                                    codeSent = true
                                    memberStatus = "인증코드를 보냈습니다. 메일함을 확인해 주세요."
                                    error = null
                                }
                                .onFailure { error = "인증코드를 보내지 못했습니다\n${reason(it)}" }
                            busy = false
                        }
                    },
                    onVerify = { email, code ->
                        val did = identity.getOrNull()?.did
                        if (did == null) {
                            error = "시민 ID를 만들지 못해 인증할 수 없습니다."
                        } else scope.launch {
                            busy = true
                            runCatching { api.verify(email, code, did) }
                                .onSuccess {
                                    codeSent = false
                                    memberStatus = "인증이 끝났습니다. 이제 글을 쓸 수 있습니다."
                                    error = null
                                }
                                .onFailure { error = "인증에 실패했습니다\n${reason(it)}" }
                            busy = false
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun NavButton(label: String, active: Boolean, onClick: () -> Unit) {
    if (active) Button(onClick = onClick) { Text(label) }
    else OutlinedButton(onClick = onClick) { Text(label) }
}
