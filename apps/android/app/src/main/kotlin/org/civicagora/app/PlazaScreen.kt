package org.civicagora.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.civicagora.core.PolicyCategory
import org.civicagora.core.PolicySummary

/**
 * 광장 — 공론 중인 주제 목록.
 *
 * 주제가 수백 개가 되면 문제는 스크롤 길이가 아니라 "무엇을 봐야 할지
 * 모른다"는 것이다. 웹·Windows 와 같은 탐색 수단을 둔다: 검색, 분류 칩,
 * 정렬 4종, 보기 3종.
 *
 * 화면 상태를 URL 에 두는 웹과 달리 여기서는 rememberSaveable 에 둔다.
 * 공유할 주소가 없으므로 링크로 보존할 이유가 없고, 회전으로 잃지만
 * 않으면 된다.
 */
@Composable
fun PlazaScreen(
    policies: List<PolicySummary>,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf<PolicyCategory?>(null) }
    var sort by rememberSaveable { mutableStateOf(PlazaSort.ACTIVE) }
    var view by rememberSaveable { mutableStateOf(PlazaView.CARD) }

    val shown = remember(policies, query, category, sort) {
        var items = policies.asSequence()
        if (query.isNotBlank()) {
            // 제목만 보면 "지역화폐"로 검색했을 때 제목에 그 말이 없는 주제를 놓친다.
            val needle = query.trim()
            items = items.filter {
                it.policy.title.contains(needle, ignoreCase = true) ||
                    it.policy.coreQuestion.contains(needle, ignoreCase = true) ||
                    it.policy.background.contains(needle, ignoreCase = true) ||
                    (it.policy.targetAgency?.contains(needle, ignoreCase = true) == true)
            }
        }
        category?.let { wanted -> items = items.filter { it.policy.category == wanted } }
        when (sort) {
            PlazaSort.RECENT -> items.sortedByDescending { it.policy.createdAt }
            PlazaSort.OPINIONS -> items.sortedWith(
                compareByDescending<PolicySummary> { opinionTotal(it) }
                    .thenByDescending { it.lastActivityAt }
            )
            PlazaSort.BALANCE -> items.sortedWith(
                compareByDescending<PolicySummary> { balanceScore(it) }
                    .thenByDescending { opinionTotal(it) }
            )
            PlazaSort.ACTIVE -> items.sortedByDescending { it.lastActivityAt }
        }.toList()
    }

    val filtered = query.isNotBlank() || category != null

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            when {
                filtered -> "검색 결과 ${shown.size}건"
                shown.isNotEmpty() -> "공론 중인 주제 ${shown.size}건"
                else -> "공론 중인 주제"
            },
            style = MaterialTheme.typography.titleMedium,
        )

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = { Text("주제·쟁점 질문·기관 검색") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { query = draft.trim() }) { Text("검색") }
            if (query.isNotBlank()) {
                TextButton(onClick = { draft = ""; query = "" }) { Text("지우기") }
            }
        }

        // 분류 칩. 개수를 함께 보여 어디에 무엇이 있는지 알린다.
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            FilterChip(
                selected = category == null,
                onClick = { category = null },
                label = { Text("전체 ${policies.size}") },
            )
            for ((value, label) in CATEGORIES) {
                val count = policies.count { it.policy.category == value }
                // 비어 있는 분류는 숨긴다. 고를 수 없는 것을 보여줄 이유가 없다.
                if (count == 0 && category != value) continue
                FilterChip(
                    selected = category == value,
                    onClick = { category = value },
                    label = { Text("$label $count") },
                )
            }
        }

        ChoiceRow("정렬", PlazaSort.entries, sort, { it.label }) { sort = it }
        ChoiceRow("보기", PlazaView.entries, view, { it.label }) { view = it }

        if (sort == PlazaSort.BALANCE) {
            Text(
                "한쪽으로 기운 주제를 먼저 보여줍니다. 반대편 의견이 가장 필요한 곳입니다.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (shown.isEmpty()) {
            Text(
                if (filtered)
                    "조건에 맞는 주제가 없습니다. 검색어를 바꾸거나 분류를 전체로 두고 다시 찾아보세요."
                else
                    "아직 올라온 주제가 없습니다. 공론화하고 싶은 정책이나 현안을 첫 번째로 올려보세요.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@Column
        }

        when (view) {
            PlazaView.CARD -> shown.forEach { PolicyCardView(it, onOpen) }
            PlazaView.LIST -> shown.forEach { PolicyLineView(it, onOpen) }
            PlazaView.SECTION -> for ((group, items) in shown.groupBy { it.policy.category }) {
                SectionHeader("${categoryLabel(group)}  ${items.size}")
                items.forEach { PolicyLineView(it, onOpen) }
            }
        }
    }
}

/** 정렬·보기 선택. 항목이 적어 드롭다운 대신 칩으로 둔다 — 한 번에 다 보인다. */
@Composable
private fun <T> ChoiceRow(
    label: String,
    options: List<T>,
    selected: T,
    labelOf: (T) -> String,
    onSelect: (T) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        for (option in options) {
            FilterChip(
                selected = option == selected,
                onClick = { onSelect(option) },
                label = { Text(labelOf(option)) },
            )
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Column(modifier = Modifier.padding(top = 6.dp)) {
        Text(text, style = MaterialTheme.typography.titleSmall)
        HorizontalDivider(modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun PolicyCardView(s: PolicySummary, onOpen: (String) -> Unit) {
    val total = opinionTotal(s)
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpen(s.policy.id) }
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    s.policy.title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    ago(s.lastActivityAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                categoryLabel(s.policy.category) +
                    (s.policy.targetAgency?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(s.policy.coreQuestion, style = MaterialTheme.typography.bodyMedium)
            DistributionBar(s, Modifier.fillMaxWidth())
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "찬성 ${s.supportCount} · 대안 ${s.alternativeCount} · 반대 ${s.opposeCount}" +
                        (if (total > 0) " · 의견 ${total}건" else ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (needsBalance(s)) {
                    // 쏠린 주제에 참여를 권한다. 반대편 의견을 데려오는 것이
                    // 목적이므로 목록에서부터 그 일을 한다.
                    Text(
                        "⚖ ${if (s.supportCount > s.opposeCount) "반대" else "찬성"} 의견이 필요해요",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFD9A441),
                    )
                }
            }
        }
    }
}

/** 목록 보기 — 한 줄로 촘촘하게. 훑을 때는 한 화면에 많이 보이는 편이 낫다. */
@Composable
private fun PolicyLineView(s: PolicySummary, onOpen: (String) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpen(s.policy.id) }
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                s.policy.title,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            DistributionBar(s, Modifier.width(72.dp))
            Text(
                "${opinionTotal(s)}건",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** 찬반 분포 막대. 가운데가 대안이다. */
@Composable
fun DistributionBar(s: PolicySummary, modifier: Modifier = Modifier) {
    val total = opinionTotal(s)
    Row(
        modifier = modifier
            .height(8.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
    ) {
        if (total == 0) return@Row
        // weight 는 0 을 받지 못하므로 0인 구간은 그리지 않는다.
        val parts = listOf(
            org.civicagora.core.StanceType.SUPPORT to s.supportCount.toInt(),
            org.civicagora.core.StanceType.ALTERNATIVE to s.alternativeCount.toInt(),
            org.civicagora.core.StanceType.OPPOSE to s.opposeCount.toInt(),
        )
        for ((stance, count) in parts) {
            if (count == 0) continue
            Box(
                modifier = Modifier
                    .weight(count.toFloat())
                    .height(8.dp)
                    .background(stanceColor(stance))
            )
        }
    }
}
