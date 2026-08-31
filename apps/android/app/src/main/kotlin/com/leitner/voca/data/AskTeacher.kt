package com.leitner.voca.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.functions.functions
import io.ktor.client.call.body
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

// DESIGN §6 '선생님한테 질문' — PC 웹 lib/askTeacher.ts 포팅. ContentSync와 동일하게
// Supabase Edge Function(ask-teacher-proxy, PC 웹과 같은 함수 재사용)을 호출한다.
// 계약: 요청 { model, question, context:{promptKo, answerEn, chunkNote?} } → 응답 { answer }.
// 질문/답변은 저장하지 않는다(1회성 인라인 Q&A).

data class AskTeacherContext(
    val promptKo: String,
    val answerEn: String,
    val chunkNote: String? = null,
)

suspend fun requestAskTeacher(
    supabase: SupabaseClient,
    model: String,
    question: String,
    context: AskTeacherContext,
): String {
    val requestBody = buildJsonObject {
        put("model", model)
        put("question", question)
        putJsonObject("context") {
            put("promptKo", context.promptKo)
            put("answerEn", context.answerEn)
            context.chunkNote?.let { put("chunkNote", it) }
        }
    }.toString()

    val response: HttpResponse = supabase.functions.invoke("ask-teacher-proxy") {
        contentType(ContentType.Application.Json)
        setBody(requestBody)
    }
    val text = response.body<String>()
    if (!response.status.isSuccess()) {
        // Edge Function은 오류 시 { "error": "..." } JSON을 돌려준다(PC 웹과 동일 계약).
        val message = runCatching {
            (Json.parseToJsonElement(text) as JsonObject)["error"]?.jsonPrimitive?.content
        }.getOrNull()
        throw RuntimeException(message ?: "질문 요청에 실패했습니다 (HTTP ${response.status.value})")
    }
    val answer = runCatching {
        (Json.parseToJsonElement(text) as JsonObject)["answer"]?.jsonPrimitive?.content
    }.getOrNull()
    return answer ?: throw RuntimeException("응답 형식이 올바르지 않습니다.")
}
