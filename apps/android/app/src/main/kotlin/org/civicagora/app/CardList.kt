package org.civicagora.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.civicagora.core.DebateCard
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 토론 카드 목록 (VS-A3).
 *
 * 지금은 최신순이다. 브리징 점수순 정렬은 VS-F3에서, 3열 배치는 VS-D1에서
 * 붙는다. 이 단계에서는 저장과 조회가 동작하는지만 보인다.
 *
 * **삭제 버튼이 없다.** 등록한 글은 지울 수 없으며, 대응은 노출 조정
 * 3단계뿐이다 (G-IMMUT).
 */
@Composable
fun CardList(cards: List<DebateCard>, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "등록된 의견 ${cards.size}건",
            style = MaterialTheme.typography.titleMedium,
        )

        if (cards.isEmpty()) {
            Text(
                "아직 등록된 의견이 없습니다.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        for (card in cards) {
            DebateCardView(card)
        }
    }
}

@Composable
private fun DebateCardView(card: DebateCard) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                StanceBadge(card)
                Text(
                    formatTime(card.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Section("문제 정의", card.problemDefinition)
            Section("근거", card.evidenceSource)
            Text(
                card.evidenceUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Section("해결책", card.actionableSolution)

            HorizontalDivider()
            Text(
                // 필명 체계는 VS-C3에서 붙는다. 그때까지는 DID 앞부분만 보인다.
                "작성자 ${card.authorDid.take(24)}…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StanceBadge(card: DebateCard) {
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
}

@Composable
private fun Section(label: String, body: String) {
    Column {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(body, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun formatTime(epochMillis: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.KOREA).format(Date(epochMillis))
