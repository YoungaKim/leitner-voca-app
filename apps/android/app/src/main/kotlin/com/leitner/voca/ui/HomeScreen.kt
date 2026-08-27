package com.leitner.voca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.leitner.voca.domain.GRADUATED_BOX
import com.leitner.voca.domain.buildTodayQueue
import com.leitner.voca.domain.today

// UXUI §3.2 홈/상자 대시보드 포팅 — PC 웹은 계단형 SVG 채움 차트지만 Compose 1차 버전은
// 박스별 카드 수를 막대 리스트로 보여준다(기능 동등, 시각 정교화는 다음 이터레이션).

private val BOX_COLORS = listOf(
    Color(0xFFEF4444), Color(0xFFF97316), Color(0xFFEAB308), Color(0xFFA3E635),
    Color(0xFF22C55E), Color(0xFF14B8A6), Color(0xFFDCA512),
)

@Composable
fun HomeScreen(state: AppUiState, onStartSession: () -> Unit, onGoDecks: () -> Unit) {
    if (state.cards.isEmpty() && state.decks.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("첫 단어장을 만들어 볼까요?", style = MaterialTheme.typography.headlineSmall)
            Text("덱을 만들고 문장 카드를 추가하거나 CSV로 가져오세요.")
            androidx.compose.foundation.layout.Spacer(Modifier.height(16.dp))
            Button(onClick = onGoDecks) { Text("단어장 관리로 이동") }
        }
        return
    }

    val queue = remember(state.cards, state.newPool, state.settings) {
        buildTodayQueue(state.cards, state.newPool, state.settings, today())
    }
    val todayCount = queue.due.size + queue.newFromPool.size
    val mastered = state.cards.count { it.box == GRADUATED_BOX }
    val boxCounts = (1..GRADUATED_BOX).map { box -> state.cards.count { it.box == box } }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Card(colors = CardDefaults.cardColors()) {
            Column(Modifier.padding(16.dp)) {
                Text("내 상자 현황", style = MaterialTheme.typography.titleMedium)
                androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
                val maxCount = maxOf(1, boxCounts.max())
                boxCounts.forEachIndexed { i, count ->
                    val label = if (i == GRADUATED_BOX - 1) "졸업" else "박스 ${i + 1}"
                    BoxRow(label, count, BOX_COLORS[i], count.toFloat() / maxCount)
                }
                Text(
                    "총 ${state.cards.size}문장 · 마스터 $mastered",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        androidx.compose.foundation.layout.Spacer(Modifier.height(16.dp))

        Card {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (todayCount > 0) {
                    Text("오늘 복습할 카드 ${todayCount}개", style = MaterialTheme.typography.titleLarge)
                    androidx.compose.foundation.layout.Spacer(Modifier.height(12.dp))
                    Button(onClick = onStartSession) { Text("학습 시작") }
                } else {
                    Text("오늘 복습 끝! 🎉", style = MaterialTheme.typography.titleLarge)
                    androidx.compose.foundation.layout.Spacer(Modifier.height(12.dp))
                }
                androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
                androidx.compose.material3.TextButton(onClick = onGoDecks) { Text("단어장 관리") }
            }
        }
    }
}

@Composable
private fun BoxRow(label: String, count: Int, color: Color, ratio: Float) {
    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        androidx.compose.foundation.layout.Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, style = MaterialTheme.typography.bodySmall)
            Text("$count", style = MaterialTheme.typography.bodySmall)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .background(Color(0xFFEDEDED), RoundedCornerShape(4.dp))
        ) {
            Box(
                Modifier
                    .fillMaxWidth(ratio.coerceIn(0f, 1f))
                    .height(8.dp)
                    .background(color, RoundedCornerShape(4.dp))
            )
        }
    }
}
