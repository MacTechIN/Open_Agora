package org.civicagora.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.civicagora.core.CardStore
import org.civicagora.core.CoreInfo
import org.civicagora.core.DebateCard
import org.civicagora.core.DraftCard
import org.civicagora.core.coreInfo
import java.io.File

/**
 * VS-A3 — 로컬 카드 작성과 조회.
 *
 * 작업 단위: docs/09_DEVELOPMENT_PLAN.md VS-A3
 *
 * 이 단계의 스텁: P2P 전파 없음(로컬 SQLite만), 서명 없음, 톤 코칭 없음.
 * 각각 VS-B1, VS-A4, VS-E1에서 붙는다.
 */
class MainActivity : ComponentActivity() {

    private lateinit var store: CardStore
    private lateinit var identity: Result<DeviceIdentity.Identity>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        identity = runCatching { DeviceIdentity.loadOrCreate() }
        val dbPath = File(filesDir, "cards.db").absolutePath
        val opened = runCatching { CardStore(dbPath) }

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    opened.fold(
                        onSuccess = { s ->
                            store = s
                            MainScreen(
                                info = remember { coreInfo() },
                                identity = identity,
                                store = s,
                            )
                        },
                        onFailure = { FatalError("저장소를 열지 못했습니다", it) },
                    )
                }
            }
        }
    }
}

@Composable
private fun MainScreen(
    info: CoreInfo,
    identity: Result<DeviceIdentity.Identity>,
    store: CardStore,
) {
    // 목록은 저장 후 다시 읽어 갱신한다. 메모리 상태와 저장소가 갈리지 않도록
    // 화면에 보이는 것은 항상 저장소에서 읽은 값이다.
    var cards by remember { mutableStateOf(runCatching { store.list() }.getOrDefault(emptyList())) }
    var error by remember { mutableStateOf<String?>(null) }

    fun reload() {
        runCatching { store.list() }
            .onSuccess { cards = it; error = null }
            .onFailure { error = it.message ?: it::class.java.simpleName }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("CivicAgora", style = MaterialTheme.typography.headlineMedium)
        Text(
            "시민 공론장 · 로컬 카드 (VS-A3)",
            style = MaterialTheme.typography.bodyMedium,
        )

        identity.fold(
            onSuccess = { id ->
                CardComposer(onSubmit = { draft ->
                    submit(store, draft, id.did)
                        .onSuccess { reload() }
                        .onFailure { error = it.message ?: it::class.java.simpleName }
                })
            },
            onFailure = {
                // 신원이 없으면 작성자를 특정할 수 없으므로 작성을 막는다.
                Text(
                    "신원을 만들지 못해 작성할 수 없습니다: ${it.message}",
                    color = MaterialTheme.colorScheme.error,
                )
            },
        )

        error?.let {
            Text("오류: $it", color = MaterialTheme.colorScheme.error)
        }

        CardList(cards)

        IdentityAndCore(info, identity)
    }
}

/** 카드를 저장한다. 실패 이유를 화면에 드러내기 위해 Result로 감싼다. */
private fun submit(store: CardStore, draft: DraftCard, authorDid: String): Result<String> =
    runCatching { store.add(draft, authorDid, System.currentTimeMillis()) }

@Composable
private fun IdentityAndCore(info: CoreInfo, identity: Result<DeviceIdentity.Identity>) {
    Card {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            identity.fold(
                onSuccess = {
                    InfoRow("내 DID", it.did)
                    InfoRow("키 보호", protectionLabel(it.protection))
                },
                onFailure = { InfoRow("신원 생성 실패", it.message ?: it::class.java.simpleName) },
            )
            InfoRow("코어 버전", "${info.version} (명세 rev ${info.specRevision})")
            InfoRow("빌드", "${info.target} · ${if (info.debug) "debug" else "release"}")
        }
    }
}

@Composable
private fun FatalError(title: String, cause: Throwable) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium,
             color = MaterialTheme.colorScheme.error)
        Text("${cause::class.java.simpleName}: ${cause.message}")
    }
}

private fun protectionLabel(protection: DeviceIdentity.Protection): String = when (protection) {
    DeviceIdentity.Protection.STRONGBOX -> "StrongBox (전용 보안 칩)"
    DeviceIdentity.Protection.TEE -> "TEE (신뢰 실행 환경)"
    DeviceIdentity.Protection.SOFTWARE -> "소프트웨어 — 보호 없음"
}

@Composable
private fun InfoRow(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}
