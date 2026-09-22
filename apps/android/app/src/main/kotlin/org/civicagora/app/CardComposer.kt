package org.civicagora.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import org.civicagora.core.DraftCard
import org.civicagora.core.StanceType
import org.civicagora.core.graphemeCount

/**
 * 3단 구조화 입력 (VS-A3).
 *
 * 명세: docs/00_PRODUCT_SPEC.md §3
 *
 * 단일 텍스트 박스를 쓰지 않는 이유는 감정적 선동을 억제하기 위해서다.
 * 세 필드가 모두 필수이며 합계 정확히 500자다.
 *
 * 글자 수는 코어의 graphemeCount로 센다. UI가 따로 세면 한글 분해나 이모지
 * 조합에서 기준이 갈려, 화면은 149자라는데 제출이 거부되는 상황이 생긴다.
 */

/** 필드별 한도. 코어의 상수와 같아야 한다. */
private const val MAX_PROBLEM = 150
private const val MAX_EVIDENCE = 200
private const val MAX_SOLUTION = 150

@Composable
fun CardComposer(
    onSubmit: (DraftCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    var stance by remember { mutableStateOf(StanceType.SUPPORT) }
    var problem by remember { mutableStateOf("") }
    var evidence by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var solution by remember { mutableStateOf("") }

    val problemCount = graphemeCount(problem).toInt()
    val evidenceCount = graphemeCount(evidence).toInt()
    val solutionCount = graphemeCount(solution).toInt()

    // 제출 가능 조건. 한도를 넘으면 버튼 자체를 막는다. 코어가 다시 검증하지만,
    // 넘긴 뒤에 거부당하는 것보다 미리 막는 편이 낫다.
    val ready = problem.isNotBlank() && problemCount <= MAX_PROBLEM &&
        evidence.isNotBlank() && evidenceCount <= MAX_EVIDENCE &&
        solution.isNotBlank() && solutionCount <= MAX_SOLUTION &&
        url.isNotBlank()

    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("의견 작성", style = MaterialTheme.typography.titleMedium)

            StancePicker(selected = stance, onSelect = { stance = it })

            CountedField(
                label = "1. 문제 정의",
                value = problem,
                count = problemCount,
                limit = MAX_PROBLEM,
                onValueChange = { problem = it },
            )

            CountedField(
                label = "2. 데이터 및 팩트 근거",
                value = evidence,
                count = evidenceCount,
                limit = MAX_EVIDENCE,
                onValueChange = { evidence = it },
            )

            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("출처 URL (필수)") },
                placeholder = { Text("https://kostat.go.kr/...") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            CountedField(
                label = "3. 실행 가능한 해결책",
                value = solution,
                count = solutionCount,
                limit = MAX_SOLUTION,
                onValueChange = { solution = it },
            )

            Button(
                onClick = {
                    onSubmit(
                        DraftCard(
                            stance = stance,
                            problemDefinition = problem,
                            evidenceSource = evidence,
                            evidenceUrl = url,
                            actionableSolution = solution,
                        )
                    )
                    // 제출 후 초기화. 스탠스는 유지한다 — 같은 입장으로 연달아
                    // 쓰는 경우가 많다.
                    problem = ""; evidence = ""; url = ""; solution = ""
                },
                enabled = ready,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("등록")
            }

            Text(
                "등록한 글은 수정하거나 지울 수 없습니다.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StancePicker(selected: StanceType, onSelect: (StanceType) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        // 찬성과 반대를 시각적으로 동등하게 둔다. 순서상 대안이 가운데다.
        for (stance in listOf(StanceType.SUPPORT, StanceType.ALTERNATIVE, StanceType.OPPOSE)) {
            FilterChip(
                selected = selected == stance,
                onClick = { onSelect(stance) },
                label = { Text(stanceLabel(stance)) },
            )
        }
    }
}

@Composable
private fun CountedField(
    label: String,
    value: String,
    count: Int,
    limit: Int,
    onValueChange: (String) -> Unit,
) {
    val over = count > limit
    Column {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            isError = over,
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            // 넘긴 만큼을 알려준다. 한도만 보여주면 얼마나 줄여야 할지 알 수 없다.
            if (over) "$count / $limit자 — ${count - limit}자 초과" else "$count / $limit자",
            style = MaterialTheme.typography.bodySmall,
            color = if (over) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, top = 2.dp),
        )
    }
}

internal fun stanceLabel(stance: StanceType): String = when (stance) {
    StanceType.SUPPORT -> "찬성"
    StanceType.ALTERNATIVE -> "대안"
    StanceType.OPPOSE -> "반대"
}

internal fun stanceColor(stance: StanceType): Color = when (stance) {
    // 좌우 어느 쪽도 우대하지 않도록 채도를 맞춘다.
    StanceType.SUPPORT -> Color(0xFF2E7D6F)
    StanceType.ALTERNATIVE -> Color(0xFF6A5ACD)
    StanceType.OPPOSE -> Color(0xFF9E5B4A)
}
