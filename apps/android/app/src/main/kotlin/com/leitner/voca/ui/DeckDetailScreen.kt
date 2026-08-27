package com.leitner.voca.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.leitner.voca.domain.GRADUATED_BOX

// UXUI §3.4 덱 상세(카드 목록) + 카드 추가 폼 포팅.
// 수동 CSV 파일 업로드는 스펙 아웃(2026-08-26, PC와 동일 결정) — 콘텐츠 소스는 구글시트 자동
// 동기화(2d)로 단일화한다. Android의 2d 이식(설정 화면 + Sheets 동기화)은 별도로 진행.

private val BOX_LABEL = listOf("", "1", "2", "3", "4", "5", "6", "졸업")

@Composable
fun DeckDetailScreen(
    deckId: String,
    state: AppUiState,
    onAddCard: (deckId: String, promptKo: String, answerEn: String, chunkNote: String?) -> Unit,
    onDeleteCard: (cardId: String) -> Unit,
) {
    val deck = state.decks.find { it.id == deckId }
    val cards = remember(state.cards, deckId) {
        state.cards.filter { it.deckId == deckId }
    }
    val newPool = remember(state.newPool, deckId) { state.newPool.filter { it.deckId == deckId } }

    var promptKo by remember { mutableStateOf("") }
    var answerEn by remember { mutableStateOf("") }
    var chunkNote by remember { mutableStateOf("") }

    if (deck == null) {
        Text("덱을 찾을 수 없습니다.", modifier = Modifier.padding(16.dp))
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text(deck.name, style = MaterialTheme.typography.headlineSmall)
        Text(
            "학습 시작한 카드 ${cards.size}개 · 저수지(대기) ${newPool.size}개",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(12.dp))

        LazyColumn(Modifier.fillMaxWidth().height(220.dp)) {
            items(cards, key = { it.id }) { card ->
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Text(card.answerEn, style = MaterialTheme.typography.bodyMedium)
                        Text("박스 ${BOX_LABEL[card.box]}", style = MaterialTheme.typography.bodySmall)
                    }
                    Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Text(card.promptKo, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { onDeleteCard(card.id) }) { Text("삭제") }
                    }
                }
                HorizontalDivider()
            }
            if (cards.isEmpty()) item { Text("카드가 없습니다.") }
        }

        Spacer(Modifier.height(16.dp))
        Text("카드 추가", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(promptKo, { promptKo = it }, label = { Text("한글 문장(제시)") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(answerEn, { answerEn = it }, label = { Text("영어 문장(정답)") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(chunkNote, { chunkNote = it }, label = { Text("청크·문법 메모(선택)") }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                onAddCard(deckId, promptKo.trim(), answerEn.trim(), chunkNote.trim().ifBlank { null })
                promptKo = ""; answerEn = ""; chunkNote = ""
            },
            enabled = promptKo.isNotBlank() && answerEn.isNotBlank(),
            modifier = Modifier.padding(top = 8.dp),
        ) { Text("카드 추가") }

        Spacer(Modifier.height(16.dp))
        Text(
            "문장을 대량으로 채우려면 설정에서 구글시트 동기화를 등록하세요(준비 중).",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
