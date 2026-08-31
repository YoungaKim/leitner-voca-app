package com.leitner.voca.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.leitner.voca.data.ContentSyncResult
import com.leitner.voca.domain.Settings

// 2d — PC 웹 SettingsPage.tsx 포팅: 구글시트 공유 링크 + 대상 덱 등록, "지금 동기화" 버튼.
// 학습량(dailyGoal 등) 설정도 같은 화면에 포함해 PC와 화면 구성을 맞춘다.

@Composable
fun SettingsScreen(
    state: AppUiState,
    onUpdateSettings: (Settings) -> Unit,
    onSyncNow: (sourceUrl: String, targetDeckId: String, onResult: (ContentSyncResult) -> Unit) -> Unit,
) {
    val settings = state.settings
    var url by remember(settings.contentSourceUrl) { mutableStateOf(settings.contentSourceUrl ?: "") }
    var deckId by remember(settings.contentSourceDeckId) {
        mutableStateOf(settings.contentSourceDeckId ?: state.decks.firstOrNull()?.id ?: "")
    }
    var deckMenuOpen by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }
    var syncErrors by remember { mutableStateOf<List<String>>(emptyList()) }

    val canSync = url.isNotBlank() && deckId.isNotBlank()
    val selectedDeckName = state.decks.find { it.id == deckId }?.name ?: "대상 단어장을 선택하세요"

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("설정", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        Text("콘텐츠 자동 동기화", style = MaterialTheme.typography.titleMedium)
        Text(
            "구글시트 공유 링크(공유 → 일반 액세스 → 링크가 있는 모든 사용자)를 등록하면 새 문장을 저수지로 흡수합니다.",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("구글시트 공유 링크") },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        Column {
            OutlinedButton(onClick = { deckMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                Text("대상 단어장: $selectedDeckName")
            }
            DropdownMenu(expanded = deckMenuOpen, onDismissRequest = { deckMenuOpen = false }) {
                if (state.decks.isEmpty()) {
                    DropdownMenuItem(text = { Text("단어장을 먼저 만들어주세요") }, onClick = { deckMenuOpen = false })
                }
                state.decks.forEach { deck ->
                    DropdownMenuItem(text = { Text(deck.name) }, onClick = { deckId = deck.id; deckMenuOpen = false })
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = settings.autoSyncEnabled,
                onCheckedChange = { onUpdateSettings(settings.copy(autoSyncEnabled = it)) },
            )
            Text("앱 켤 때 하루 1회 자동 동기화")
        }
        Spacer(Modifier.height(8.dp))
        Row {
            Button(
                onClick = {
                    onUpdateSettings(settings.copy(contentSourceUrl = url.trim().ifBlank { null }, contentSourceDeckId = deckId.ifBlank { null }))
                },
                enabled = url.isNotBlank() && deckId.isNotBlank(),
            ) { Text("저장") }
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = {
                    syncing = true
                    syncErrors = emptyList()
                    onSyncNow(url.trim(), deckId) { result ->
                        syncing = false
                        syncErrors = result.errors
                    }
                },
                enabled = canSync && !syncing,
            ) { Text(if (syncing) "동기화 중…" else "지금 동기화") }
        }

        state.syncState.lastSyncAt?.let {
            Spacer(Modifier.height(8.dp))
            Text("마지막 동기화: $it · ${state.syncState.lastSyncResult ?: ""}", style = MaterialTheme.typography.bodySmall)
        }
        syncErrors.forEach { err ->
            Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))
        Text("학습 보조", style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = settings.ttsAutoPlay,
                onCheckedChange = { onUpdateSettings(settings.copy(ttsAutoPlay = it)) },
            )
            Text("정답 공개 시 영어 발음 자동 재생(듣기)")
        }
        Spacer(Modifier.height(8.dp))
        Text("선생님한테 질문에 쓸 AI 모델", style = MaterialTheme.typography.bodyMedium)
        var aiMenuOpen by remember { mutableStateOf(false) }
        val aiModels = listOf("claude" to "Claude", "gemini" to "Gemini", "gpt" to "GPT")
        Column {
            OutlinedButton(onClick = { aiMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                Text(aiModels.find { it.first == settings.preferredAiModel }?.second ?: "Claude")
            }
            DropdownMenu(expanded = aiMenuOpen, onDismissRequest = { aiMenuOpen = false }) {
                aiModels.forEach { (value, label) ->
                    DropdownMenuItem(
                        text = { Text(label) },
                        onClick = {
                            onUpdateSettings(settings.copy(preferredAiModel = value))
                            aiMenuOpen = false
                        },
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))
        Text("학습량", style = MaterialTheme.typography.titleMedium)
        SettingsNumberField("하루 목표(dailyGoal)", settings.dailyGoal) { onUpdateSettings(settings.copy(dailyGoal = it)) }
        SettingsNumberField("복습 상한(reviewCap)", settings.reviewCap) { onUpdateSettings(settings.copy(reviewCap = it)) }
        SettingsNumberField("하루 신규 상한(newCap)", settings.newCap) { onUpdateSettings(settings.copy(newCap = it)) }
        SettingsNumberField("학습 중 카드 총량 상한(maxActiveCards)", settings.maxActiveCards) { onUpdateSettings(settings.copy(maxActiveCards = it)) }
    }
}

@Composable
private fun SettingsNumberField(label: String, value: Int, onChange: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        OutlinedTextField(
            value = text,
            onValueChange = { text = it; it.toIntOrNull()?.let(onChange) },
            modifier = Modifier.width(100.dp),
            singleLine = true,
        )
    }
}
