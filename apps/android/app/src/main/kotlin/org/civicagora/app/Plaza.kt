package org.civicagora.app

import androidx.compose.ui.graphics.Color
import org.civicagora.core.PolicyCategory
import org.civicagora.core.PolicySummary
import org.civicagora.core.StanceType
import kotlin.math.abs

/**
 * 광장의 표시 규칙.
 *
 * 웹(web/lib/plaza-view.ts, web/lib/plaza.ts)·Windows(MainWindow.xaml.cs)와
 * **같은 값**을 쓴다. 세 곳이 달라지면 같은 주제가 기기마다 다르게
 * 표시되고, 그것은 화면 버그가 아니라 신뢰 문제가 된다.
 *
 * 이 값들이 코어(UDL)가 아니라 각 앱에 있는 이유는 표시 문구이기 때문이다.
 * 코어는 저장되는 것만 정한다.
 */

/** 정렬 기준. 순서와 문구가 웹의 SORTS 와 같다. */
enum class PlazaSort(val label: String) {
    ACTIVE("활발한 순"),
    BALANCE("균형 필요"),
    RECENT("최신순"),
    OPINIONS("의견 많은 순"),
}

/** 보기 방식. 웹의 VIEWS 와 같다. */
enum class PlazaView(val label: String) {
    CARD("카드"),
    LIST("목록"),
    SECTION("분류별"),
}

/** 분류. UDL 의 PolicyCategory 순서를 따른다. */
val CATEGORIES: List<Pair<PolicyCategory, String>> = listOf(
    PolicyCategory.GOV_POLICY to "정부정책",
    PolicyCategory.LEGISLATION to "입법안",
    PolicyCategory.PARTY_POLICY to "정당정책",
    PolicyCategory.LOCAL to "지자체",
    PolicyCategory.PUBLIC_ORG to "공공기관",
    PolicyCategory.SOCIAL_ISSUE to "사회현안",
    PolicyCategory.WHISTLEBLOW to "문제고발",
)

fun categoryLabel(category: PolicyCategory): String =
    CATEGORIES.firstOrNull { it.first == category }?.second ?: "기타"

fun stanceLabel(stance: StanceType): String = when (stance) {
    StanceType.SUPPORT -> "찬성"
    StanceType.ALTERNATIVE -> "대안"
    StanceType.OPPOSE -> "반대"
}

/** 좌우 어느 쪽도 우대하지 않도록 채도를 맞춘다. Windows·웹과 같은 값이다. */
fun stanceColor(stance: StanceType): Color = when (stance) {
    StanceType.SUPPORT -> Color(0xFF2E7D6F)
    StanceType.ALTERNATIVE -> Color(0xFF6A5ACD)
    StanceType.OPPOSE -> Color(0xFF9E5B4A)
}

fun opinionTotal(s: PolicySummary): Int =
    (s.supportCount + s.alternativeCount + s.opposeCount).toInt()

/**
 * 쏠린 정도. 1에 가까울수록 한쪽으로 기울었다.
 *
 * 0대0 이나 1대0 은 기운 것이 아니라 아직 시작하지 않은 것이다. 그래서
 * 양쪽 합이 2 미만이면 정렬에서 뒤로 보낸다(-1).
 */
fun balanceScore(s: PolicySummary): Double {
    val sides = (s.supportCount + s.opposeCount).toInt()
    if (sides < 2) return -1.0
    return abs(s.supportCount.toInt() - s.opposeCount.toInt()) / sides.toDouble()
}

fun needsBalance(s: PolicySummary): Boolean = balanceScore(s) >= 0.6

/** 목록에 보이는 상대 시각. */
fun ago(epochMillis: Long): String {
    val minutes = (System.currentTimeMillis() - epochMillis) / 60_000
    return when {
        minutes < 1 -> "방금"
        minutes < 60 -> "${minutes}분 전"
        minutes < 1440 -> "${minutes / 60}시간 전"
        else -> "${minutes / 1440}일 전"
    }
}

fun shortenDid(did: String): String = if (did.length <= 24) did else did.take(24) + "…"
