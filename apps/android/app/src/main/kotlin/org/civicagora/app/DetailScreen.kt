package org.civicagora.app

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.civicagora.core.DebateCard
import org.civicagora.core.DraftCard
import org.civicagora.core.PolicySummary
import org.civicagora.core.StanceType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 주제 상세 — 쟁점 질문, 의견, 의견 쓰기.
 *
 * 웹과 Windows 는 찬성·대안·반대를 3열로 나란히 둔다. **어느 쪽도 우대하지
 * 않는다**는 것이 그 배치의 뜻이다. 휴대폰 너비에서는 3열이 읽히지 않으므로
 * 같은 뜻을 다른 수단으로 지킨다 — 세 입장을 같은 크기의 칩으로 두고,
 * 기본값을 「전체」로 해서 어느 한쪽을 먼저 보여주지 않는다.
 */
@Composable
fun DetailScreen(
    summary: PolicySummary,
    opinions: List<DebateCard>,
    busy: Boolean,
    onSubmit: (DraftCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    var stanceFilter by rememberSaveable { mutableStateOf<StanceType?>(null) }
    val policy = summary.policy

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(policy.title, style = MaterialTheme.typography.titleLarge)
                Text(
                    categoryLabel(policy.category) +
                        (policy.targetAgency?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Labeled("쟁점 질문") {
                    Text(policy.coreQuestion, style = MaterialTheme.typography.titleSmall)
                }
                Labeled("왜 지금 이슈인가") {
                    Text(policy.background, style = MaterialTheme.typography.bodyMedium)
                }
                Text(
                    policy.officialSourceUrl,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        Text("의견 ${opinions.size}건", style = MaterialTheme.typography.titleMedium)
        DistributionBar(summary, Modifier.fillMaxWidth())

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            FilterChip(
                selected = stanceFilter == null,
                onClick = { stanceFilter = null },
                label = { Text("전체 ${opinions.size}") },
            )
            for (stance in listOf(StanceType.SUPPORT, StanceType.ALTERNATIVE, StanceType.OPPOSE)) {
                val count = opinions.count { it.stance == stance }
                val label = if (stance == StanceType.ALTERNATIVE) "대안 · 합의" else stanceLabel(stance)
                FilterChip(
                    selected = stanceFilter == stance,
                    onClick = { stanceFilter = stance },
                    label = { Text("$label $count") },
                )
            }
        }

        val shown = stanceFilter?.let { wanted -> opinions.filter { it.stance == wanted } } ?: opinions
        if (shown.isEmpty()) {
            Text(
                "아직 없습니다. 첫 의견을 남겨보세요.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        shown.forEach { OpinionCard(it) }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("내 의견 남기기", style = MaterialTheme.typography.titleMedium)
                Text(
                    policy.coreQuestion,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OpinionForm(submitLabel = "의견 올리기", busy = busy, onSubmit = onSubmit)
            }
        }
    }
}

@Composable
private fun OpinionCard(card: DebateCard) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Box(
                    modifier = Modifier
                        .background(stanceColor(card.stance), RoundedCornerShape(4.dp))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text(
                        stanceLabel(card.stance),
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Text(
                    formatTime(card.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Labeled("논점") { Text(card.problemDefinition, style = MaterialTheme.typography.bodyMedium) }
            Labeled("근거") { Text(card.evidenceSource, style = MaterialTheme.typography.bodyMedium) }
            Text(
                card.evidenceUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Labeled("제안") { Text(card.actionableSolution, style = MaterialTheme.typography.bodyMedium) }

            HorizontalDivider()
            Text(
                // 필명 체계는 VS-C3 에서 붙는다. 그때까지는 식별자 앞부분만 보인다.
                "작성자 ${shortenDid(card.authorDid)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Labeled(label: String, content: @Composable () -> Unit) {
    Column {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}

private fun formatTime(epochMillis: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.KOREA).format(Date(epochMillis))
