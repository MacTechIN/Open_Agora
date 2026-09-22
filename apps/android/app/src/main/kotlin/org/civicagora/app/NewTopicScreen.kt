package org.civicagora.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.civicagora.core.DraftCard
import org.civicagora.core.DraftPolicy
import org.civicagora.core.PolicyCategory
import org.civicagora.core.graphemeCount

/**
 * 주제 올리기.
 *
 * 주제만 던지고 빠지는 것을 막기 위해 첫 의견을 함께 받는다. 둘은 서버에서
 * 한 트랜잭션으로 처리된다(core/src/store.rs open_policy).
 *
 * 한도는 코어(core/src/policy.rs)와 같아야 한다.
 */
private const val MAX_TITLE = 60
private const val MAX_BACKGROUND = 300
private const val MAX_QUESTION = 100

@Composable
fun NewTopicScreen(
    busy: Boolean,
    onSubmit: (DraftPolicy, DraftCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    var title by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(PolicyCategory.GOV_POLICY) }
    var background by rememberSaveable { mutableStateOf("") }
    var question by rememberSaveable { mutableStateOf("") }
    var sourceUrl by rememberSaveable { mutableStateOf("") }
    var agency by rememberSaveable { mutableStateOf("") }

    val titleCount = countOf(title)
    val backgroundCount = countOf(background)
    val questionCount = countOf(question)

    // 주제 쪽이 덜 찼으면 의견 폼의 등록 버튼도 눌리지 않게 한다. 의견만
    // 다 쓰고 눌렀다가 거부당하는 일을 막는다.
    val policyReady = titleCount in 1..MAX_TITLE &&
        backgroundCount in 1..MAX_BACKGROUND &&
        questionCount in 1..MAX_QUESTION &&
        sourceUrl.isNotBlank()

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("주제 올리기", style = MaterialTheme.typography.titleLarge)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("무엇을 공론화하려 하시나요?", style = MaterialTheme.typography.titleMedium)

                Counted("주제 제목", title, titleCount, MAX_TITLE,
                    "예) 탄력 근로제 직종별 차등 적용", singleLine = true) { title = it }

                Column {
                    Text(
                        "분류",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        for ((value, label) in CATEGORIES) {
                            FilterChip(
                                selected = category == value,
                                onClick = { category = value },
                                label = { Text(label) },
                            )
                        }
                    }
                }

                Counted("왜 지금 이슈인가요?", background, backgroundCount, MAX_BACKGROUND,
                    "예) 최근 개정안이 발의되면서 업종별 적용 기준을 두고 노사 간 이견이 커지고 있습니다.") {
                    background = it
                }

                Column {
                    Counted("쟁점 질문", question, questionCount, MAX_QUESTION,
                        "예) 직종별로 탄력 근로제 적용 기준을 달리해야 하는가?", singleLine = true) {
                        question = it
                    }
                    Text(
                        "찬성과 반대가 갈릴 수 있는 하나의 질문으로 적어주세요. 이 질문이 토론의 축이 됩니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Column {
                    OutlinedTextField(
                        value = sourceUrl,
                        onValueChange = { sourceUrl = it },
                        label = { Text("공식 출처 링크") },
                        placeholder = { Text("https://likms.assembly.go.kr/...") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "법령, 의안, 보도자료 같은 1차 자료를 적어주세요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                OutlinedTextField(
                    value = agency,
                    onValueChange = { agency = it },
                    label = { Text("소관 기관 (선택)") },
                    placeholder = { Text("예) 고용노동부") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("이 질문에 대한 내 입장", style = MaterialTheme.typography.titleMedium)
                Text(
                    "주제를 여는 분도 자기 의견을 함께 남깁니다. 토론이 빈 상태로 시작하지 않도록 하기 위해서입니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!policyReady) {
                    Text(
                        "위의 주제 항목을 먼저 채워주세요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                OpinionForm(
                    submitLabel = "주제 올리기",
                    busy = busy,
                    enabled = policyReady,
                    onSubmit = { opinion ->
                        onSubmit(
                            DraftPolicy(
                                title = title.trim(),
                                category = category,
                                background = background.trim(),
                                coreQuestion = question.trim(),
                                officialSourceUrl = sourceUrl.trim(),
                                targetAgency = agency.trim().ifBlank { null },
                            ),
                            opinion,
                        )
                    },
                )
            }
        }
    }
}

private fun countOf(text: String): Int =
    if (text.isBlank()) 0 else graphemeCount(text.trim()).toInt()

@Composable
private fun Counted(
    label: String,
    value: String,
    count: Int,
    limit: Int,
    placeholder: String,
    singleLine: Boolean = false,
    onValueChange: (String) -> Unit,
) {
    val over = count > limit
    Column {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            placeholder = { Text(placeholder) },
            isError = over,
            singleLine = singleLine,
            minLines = if (singleLine) 1 else 3,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            if (over) "$count / ${limit}자 — ${count - limit}자 초과" else "$count / ${limit}자",
            style = MaterialTheme.typography.bodySmall,
            color = if (over) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
