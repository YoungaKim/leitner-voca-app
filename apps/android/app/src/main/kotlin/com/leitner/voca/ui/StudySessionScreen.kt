package com.leitner.voca.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.leitner.voca.domain.Card
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.ReviewLog
import com.leitner.voca.domain.ReviewResult
import com.leitner.voca.domain.buildTodayQueue
import com.leitner.voca.domain.introduceFromPool
import com.leitner.voca.domain.isCorrect
import com.leitner.voca.domain.onAnswer
import com.leitner.voca.domain.today

// UXUI §3.3 학습 세션 포팅 — 제시(한글) → 힌트(선택) → 정답 확인 3단계, 힌트 사다리 채점.
// 큐(오늘 복습할 카드 + 저수지에서 끌어올 신규)는 화면 진입 시 1회 스냅샷으로 고정한다
// (PC 웹과 동일 원칙 — 세션 도중 카드가 갱신돼도 큐 순서가 흔들리지 않도록).

private sealed interface QueueItem {
    data class Existing(val card: Card) : QueueItem
    data class FromPool(val pool: NewPoolItem) : QueueItem
}

@Composable
fun StudySessionScreen(
    state: AppUiState,
    onApplyReview: (cardId: String, updated: Card, log: ReviewLog) -> Unit,
    onIntroduce: (card: Card, poolId: String) -> Unit,
    onClose: () -> Unit,
) {
    // 세션 시작 시점의 큐를 한 번만 계산해서 고정한다(PC 웹 StudySessionPage와 동일 원칙,
    // useMemo(..., []) 대응) — remember에 키를 안 줘서 이후 state.cards가 바뀌어도(채점 결과
    // 반영) 큐 자체는 재계산되지 않고, index가 그 고정된 리스트 안에서만 전진한다.
    val queue = remember {
        val q = buildTodayQueue(state.cards, state.newPool, state.settings, today())
        (q.due.map { QueueItem.Existing(it) } + q.newFromPool.map { QueueItem.FromPool(it) })
    }

    var index by remember { mutableIntStateOf(0) }
    var hintLevel by remember { mutableIntStateOf(0) }
    var stage by remember { mutableStateOf(0) } // 0=제시, 1=힌트, 2=정답확인
    var correctCount by remember { mutableIntStateOf(0) }
    var totalAnswered by remember { mutableIntStateOf(0) }

    if (queue.isEmpty() || index >= queue.size) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("세션 요약", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(12.dp))
            Text("맞은 개수 $correctCount / $totalAnswered")
            Spacer(Modifier.height(24.dp))
            Button(onClick = onClose) { Text("홈으로") }
        }
        return
    }

    val item = queue[index]
    val (promptKo, answerEn, box) = when (item) {
        is QueueItem.Existing -> Triple(item.card.promptKo, item.card.answerEn, item.card.box)
        is QueueItem.FromPool -> Triple(item.pool.promptKo, item.pool.answerEn, 0)
    }

    fun grade(userClaimedKnew: Boolean) {
        val correct = isCorrect(hintLevel, userClaimedKnew, state.settings)
        when (item) {
            is QueueItem.Existing -> {
                val updated = onAnswer(item.card, correct, state.settings, today())
                val log = ReviewLog(
                    id = java.util.UUID.randomUUID().toString(),
                    cardId = item.card.id,
                    date = today(),
                    result = if (correct) ReviewResult.CORRECT else ReviewResult.WRONG,
                    boxBefore = item.card.box,
                    boxAfter = updated.box,
                    hintLevel = hintLevel,
                )
                onApplyReview(item.card.id, updated, log)
            }
            is QueueItem.FromPool -> {
                val newCard = introduceFromPool(item.pool, today())
                val graded = onAnswer(newCard, correct, state.settings, today())
                onIntroduce(graded, item.pool.id)
            }
        }
        if (correct) correctCount++
        totalAnswered++
        index++
        hintLevel = 0
        stage = 0
    }

    Column(Modifier.fillMaxSize().padding(24.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onClose) { Text("닫기") }
            Text("${index + 1} / ${queue.size}")
            Text(if (box > 0) "박스 $box" else "신규")
        }

        Spacer(Modifier.height(24.dp))

        when (stage) {
            0 -> {
                // 제시: 한글만
                Text(promptKo, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(24.dp))
                OutlinedButton(onClick = { stage = 1 }) { Text("힌트") }
                Spacer(Modifier.height(8.dp))
                Button(onClick = { stage = 2 }) { Text("정답 확인") }
            }
            1 -> {
                // 힌트 사다리: 레벨을 올릴수록 영문 단서를 더 공개(1차 버전은 단어 수만 공개)
                Text(promptKo, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                val wordCount = answerEn.split(" ").size
                Text("힌트 레벨 ${hintLevel + 1}: ${wordCount}단어")
                Text(
                    if (hintLevel < state.settings.hintFreeLevel) "채점 영향 없음" else "채점 영향 있음(자동 오답)",
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(16.dp))
                Row {
                    OutlinedButton(onClick = { hintLevel++ }) { Text("힌트 더 보기") }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { stage = 2 }) { Text("정답 확인") }
                }
            }
            2 -> {
                // 정답 확인: 전체 영문 + 자기 채점
                Text(promptKo, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                Text(answerEn, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(24.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    OutlinedButton(onClick = { grade(false) }) { Text("몰랐어") }
                    Button(onClick = { grade(true) }) { Text("알았어") }
                }
            }
        }
    }
}
