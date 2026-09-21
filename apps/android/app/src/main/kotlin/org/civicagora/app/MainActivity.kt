package org.civicagora.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.civicagora.core.CoreInfo
import org.civicagora.core.coreInfo

/**
 * VS-A1 — 골격 검증 화면.
 *
 * 공유 Rust 코어를 uniffi 바인딩으로 호출해 결과를 표시한다. 이 화면이
 * 뜨면 UI → 바인딩 → 코어 경로가 뚫린 것이고, 이후 모든 슬라이스가
 * 이 위에 올라탄다.
 *
 * 작업 단위: docs/09_DEVELOPMENT_PLAN.md VS-A1
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val info = remember { coreInfo() }
                    // 키는 Keystore 안에 있고 여기선 DID만 받는다.
                    // 실패해도 앱이 죽지 않게 한다. 신원 생성 실패는 진단 정보가 필요하다.
                    val identity = remember {
                        runCatching { DeviceIdentity.loadOrCreate() }
                    }
                    CoreInfoScreen(info, identity)
                }
            }
        }
    }
}

@Composable
private fun CoreInfoScreen(
    info: CoreInfo,
    identity: Result<DeviceIdentity.Identity>,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("CivicAgora", style = MaterialTheme.typography.headlineMedium)
        Text(
            "시민 공론장 · 기기 신원 (VS-A2)",
            style = MaterialTheme.typography.bodyMedium,
        )

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
            }
        }
        Card(modifier = Modifier.padding(top = 12.dp)) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                InfoRow("코어 버전", info.version)
                InfoRow("명세 계약", "rev ${info.specRevision}")
                InfoRow("빌드 대상", info.target)
                InfoRow("빌드 프로필", if (info.debug) "debug" else "release")
            }
        }
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
