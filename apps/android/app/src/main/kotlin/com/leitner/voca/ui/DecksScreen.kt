package com.leitner.voca.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.leitner.voca.domain.Deck

// UXUI §3.4 단어장 목록 포팅.

@Composable
fun DecksScreen(
    state: AppUiState,
    onAddDeck: (String) -> Unit,
    onDeleteDeck: (String) -> Unit,
    onOpenDeck: (String) -> Unit,
    onOpenSettings: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var pendingDelete by remember { mutableStateOf<Deck?>(null) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("단어장", style = MaterialTheme.typography.headlineSmall)
            TextButton(onClick = onOpenSettings) { Text("설정") }
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("새 단어장 이름") },
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = { if (name.isNotBlank()) { onAddDeck(name.trim()); name = "" } }, enabled = name.isNotBlank()) {
                Text("추가")
            }
        }
        Spacer(Modifier.height(16.dp))

        if (state.decks.isEmpty()) {
            Text("아직 단어장이 없습니다.")
        } else {
            LazyColumn {
                items(state.decks, key = { it.id }) { deck ->
                    val total = state.cards.count { it.deckId == deck.id } + state.newPool.count { it.deckId == deck.id }
                    val onBox = state.cards.count { it.deckId == deck.id }
                    val pool = state.newPool.count { it.deckId == deck.id }
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        onClick = { onOpenDeck(deck.id) },
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text(deck.name, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "총 $total · 박스 진행 $onBox · 대기(pool) $pool",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            TextButton(onClick = { pendingDelete = deck }) { Text("삭제") }
                        }
                    }
                }
            }
        }
    }

    pendingDelete?.let { deck ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("\"${deck.name}\" 단어장을 삭제할까요?") },
            text = { Text("이 덱의 카드와 저수지 항목이 전부 지워지고 되돌릴 수 없습니다.") },
            confirmButton = {
                TextButton(onClick = { onDeleteDeck(deck.id); pendingDelete = null }) { Text("삭제") }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("취소") } },
        )
    }
}
