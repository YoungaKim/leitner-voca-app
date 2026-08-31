package com.leitner.voca.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// UXUI §3.3 '선생님한테 질문' — 학습 세션 안 카드 컨텍스트 기반 1회성 Q&A 인라인 패널(PC 웹
// AskTeacherPanel.tsx 포팅). 질문/답변은 저장하지 않는다(DESIGN §6).

@Composable
fun AskTeacherPanel(
    onAsk: (question: String, onResult: (Result<String>) -> Unit) -> Unit,
    onClose: () -> Unit,
) {
    var question by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    Card(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("🧑‍🏫 선생님한테 질문", style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = onClose) { Text("닫기") }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = question,
                onValueChange = { question = it },
                label = { Text("이 문장에 대해 궁금한 점을 물어보세요") },
                modifier = Modifier.fillMaxWidth(),
                enabled = !loading,
                singleLine = false,
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    val q = question.trim()
                    if (q.isEmpty() || loading) return@Button
                    loading = true
                    error = null
                    answer = null
                    onAsk(q) { result ->
                        loading = false
                        result.onSuccess { answer = it }
                        result.onFailure { error = it.message ?: it.toString() }
                    }
                },
                enabled = !loading && question.isNotBlank(),
            ) { Text("질문하기") }

            if (loading) {
                Spacer(Modifier.height(8.dp))
                Text("답변 준비 중...", style = MaterialTheme.typography.bodySmall)
            }
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(
                    "지금은 답변을 받아올 수 없어요. 잠시 후 다시 시도해 주세요. ($it)",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            answer?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
