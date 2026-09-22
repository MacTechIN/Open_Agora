package org.civicagora.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.civicagora.core.DraftCard
import org.civicagora.core.StanceType
import org.civicagora.core.graphemeCount

/**
 * 의견 작성 폼 (3단 구조화 입력).
 *
 * 입장에 따라 **묻는 말이 바뀐다.** 찬성하는 사람에게 "무엇이 문제인가"를
 * 묻는 것은 답할 수 없는 질문이다. 저장되는 필드의 의미(논점·근거·제안)와
 * 길이 제한은 고정이고 화면 문구만 바뀐다.
 *
 * 명세: docs/00_PRODUCT_SPEC.md §3.1 · 결정: D17
 * Windows 의 OpinionForm.cs 와 문구가 같아야 한다.
 *
 * 단일 텍스트 박스를 쓰지 않는 이유는 감정적 선동을 억제하기 위해서다.
 * 세 필드가 모두 필수이며 합계 500자다.
 */

/** 필드별 한도. 코어의 상수(core/src/card.rs)와 같아야 한다. */
private const val MAX_PROBLEM = 150
private const val MAX_EVIDENCE = 200
private const val MAX_SOLUTION = 150

/**
 * 입장별 질문. 세 갈래뿐이라 표로 두지 않고 when 으로 둔다.
 * 첫 번째가 ①, 두 번째가 ③ 이다. ② 근거는 입장과 무관하게 같다.
 */
private fun questions(stance: StanceType): Pair<String, String> = when (stance) {
    StanceType.SUPPORT -> "① 왜 이 방향이 옳다고 보시나요?" to "③ 잘 되려면 무엇이 필요할까요?"
    StanceType.ALTERNATIVE -> "① 어떤 점이 아쉬운가요?" to "③ 어떤 대안을 제안하시나요?"
    StanceType.OPPOSE -> "① 무엇이 문제인가요?" to "③ 대신 어떻게 하면 좋을까요?"
}

@Composable
fun OpinionForm(
    submitLabel: String,
    busy: Boolean,
    onSubmit: (DraftCard) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    // rememberSaveable 을 쓴다. 화면 회전으로 쓰던 글이 날아가면 다시 쓰지
    // 않는다. 의견 하나를 잃는 것이 아니라 그 사람을 잃는다.
    var stance by rememberSaveable { mutableStateOf(StanceType.SUPPORT) }
    var problem by rememberSaveable { mutableStateOf("") }
    var evidence by rememberSaveable { mutableStateOf("") }
    var url by rememberSaveable { mutableStateOf("") }
    var solution by rememberSaveable { mutableStateOf("") }

    val (problemLabel, solutionLabel) = questions(stance)
    val problemCount = count(problem)
    val evidenceCount = count(evidence)
    val solutionCount = count(solution)

    // 한도를 넘으면 버튼 자체를 막는다. 코어가 다시 검증하지만, 보낸 뒤에
    // 거부당하는 것보다 미리 막는 편이 낫다.
    val ready = !busy && enabled &&
        problemCount in 1..MAX_PROBLEM &&
        evidenceCount in 1..MAX_EVIDENCE &&
        solutionCount in 1..MAX_SOLUTION &&
        url.isNotBlank()

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("어떤 입장이신가요?", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // 찬성과 반대를 시각적으로 동등하게 둔다. 순서상 대안이 가운데다.
            for (option in listOf(StanceType.SUPPORT, StanceType.ALTERNATIVE, StanceType.OPPOSE)) {
                FilterChip(
                    selected = stance == option,
                    onClick = { stance = option },
                    label = { Text(if (option == StanceType.ALTERNATIVE) "대안 제시" else stanceLabel(option)) },
                )
            }
        }

        CountedField(
            label = problemLabel,
            value = problem,
            count = problemCount,
            limit = MAX_PROBLEM,
            placeholder = "예) 현행 제도가 모든 업종에 똑같이 적용되어 소상공인에게 과도한 행정 부담을 줍니다.",
            onValueChange = { problem = it },
        )

        CountedField(
            label = "② 어떤 근거가 있나요?",
            value = evidence,
            count = evidenceCount,
            limit = MAX_EVIDENCE,
            placeholder = "예) 통계청 2026년 사업체노동력조사에서 5인 미만 사업장의 행정 부담이 가장 높게 나타났습니다.",
            onValueChange = { evidence = it },
        )

        Column {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("근거 자료의 출처 링크") },
                placeholder = { Text("https://kostat.go.kr/...") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "통계청, 정부 고시, 국회 의안, 학술 논문 같은 1차 자료를 권합니다.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        CountedField(
            label = solutionLabel,
            value = solution,
            count = solutionCount,
            limit = MAX_SOLUTION,
            placeholder = "예) 업종별로 기준을 나누고, 소규모 사업장에는 신고 절차를 간소화합니다.",
            onValueChange = { solution = it },
        )

        Button(
            onClick = {
                onSubmit(
                    DraftCard(
                        stance = stance,
                        problemDefinition = problem.trim(),
                        evidenceSource = evidence.trim(),
                        evidenceUrl = url.trim(),
                        actionableSolution = solution.trim(),
                    )
                )
                // 보낸 뒤 비운다. 입장은 유지한다 — 같은 입장으로 연달아 쓰는
                // 경우가 많다. 실패하면 부모가 다시 보여주지 않으므로 여기서
                // 비우는 것은 낙관적이지만, 코어가 보내기 전에 검증하므로
                // 형식 오류로 잃는 일은 없다.
                problem = ""; evidence = ""; url = ""; solution = ""
            },
            enabled = ready,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (busy) "올리는 중…" else submitLabel)
        }

        Text(
            "올린 글은 수정하거나 지울 수 없습니다.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * 글자 수는 코어의 graphemeCount 로 센다.
 *
 * UI 가 따로 세면 한글 분해나 이모지 조합에서 기준이 갈려, 화면은 149자라는데
 * 제출이 거부되는 상황이 생긴다.
 */
private fun count(text: String): Int =
    if (text.isBlank()) 0 else graphemeCount(text.trim()).toInt()

@Composable
private fun CountedField(
    label: String,
    value: String,
    count: Int,
    limit: Int,
    placeholder: String,
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
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            // 넘긴 만큼을 알려준다. 한도만 보여주면 얼마나 줄여야 할지 알 수 없다.
            if (over) "$count / ${limit}자 — ${count - limit}자 초과" else "$count / ${limit}자",
            style = MaterialTheme.typography.bodySmall,
            color = if (over) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
