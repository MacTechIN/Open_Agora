package org.civicagora.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.civicagora.core.CoreInfo

/**
 * 시민 인증.
 *
 * 이메일로 한 번 확인하고 나면 **회원 자격만 남는다.** 어떤 글이 누구의
 * 것인지는 서버에 저장하지 않는다. 지금은 확인 시점에 서버가 이메일과 DID 를
 * 함께 보므로 그 순간만큼은 연결이 가능하다 — 이 마지막 연결을 끊는 것이
 * VS-C3(ZK-Email)이다. 사실대로 적어 둔다.
 *
 * 코드를 화면에 표시하지 않는다. 응답에 코드가 담기면 남의 이메일로 가입할
 * 수 있게 된다.
 */
@Composable
fun MemberScreen(
    identity: Result<DeviceIdentity.Identity>,
    info: CoreInfo,
    busy: Boolean,
    status: String?,
    codeSent: Boolean,
    onRequestCode: (String) -> Unit,
    onVerify: (String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("시민 인증", style = MaterialTheme.typography.titleLarge)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    "글을 쓰려면 이메일 인증이 한 번 필요합니다. 한 이메일로 한 사람만 가입할 수 있습니다.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "인증이 끝나면 회원 자격만 남습니다. 어떤 글이 누구의 것인지는 저장하지 않습니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("이메일") },
                    placeholder = { Text("name@example.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onRequestCode(email.trim()) },
                    enabled = !busy && email.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("인증코드 받기") }

                if (codeSent) {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it.take(6) },
                        label = { Text("인증코드 (6자리)") },
                        placeholder = { Text("000000") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = { onVerify(email.trim(), code.trim()) },
                        enabled = !busy && code.length == 6,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("인증 완료하기") }
                }

                status?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("내 시민 ID", style = MaterialTheme.typography.titleMedium)
                identity.fold(
                    onSuccess = {
                        Text(it.did, style = MaterialTheme.typography.bodySmall)
                        Text(
                            protectionLabel(it.protection),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    onFailure = {
                        Text(
                            "시민 ID를 만들지 못했습니다: ${it.message ?: it::class.java.simpleName}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    },
                )
                Text(
                    "CivicAgora ${info.version} (명세 rev ${info.specRevision}) · ${info.target}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun protectionLabel(protection: DeviceIdentity.Protection): String = when (protection) {
    DeviceIdentity.Protection.STRONGBOX -> "StrongBox (전용 보안 칩)에 보관 — 가장 안전합니다"
    DeviceIdentity.Protection.TEE -> "TEE (신뢰 실행 환경)에 보관 — 꺼내갈 수 없습니다"
    DeviceIdentity.Protection.SOFTWARE -> "소프트웨어 보관 — 하드웨어 보호가 없습니다"
}
