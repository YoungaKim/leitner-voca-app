package com.leitner.voca.data

import com.leitner.voca.domain.Card
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.SyncState
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
import java.time.Instant

// 2d — PC 웹 lib/contentSync.ts 포팅. 게시된 구글시트를 Supabase Edge Function(content-sync-proxy,
// PC 웹과 동일한 함수를 그대로 재사용)으로 읽어와 새 id만 저수지로 흡수한다. dedupe는 계정 전체
// 범위(어느 덱이든 이미 카드/저수지에 있거나 syncState.importedIds에 있으면 스킵) — PC와 동일 규칙.

/** 계정 전체 범위(덱 무관) dedupe 키 집합. */
fun accountWideImportedIds(cards: List<Card>, newPool: List<NewPoolItem>, syncState: SyncState): Set<String> {
    val ids = mutableSetOf<String>()
    ids.addAll(syncState.importedIds)
    for (c in cards) ids.add(c.sourceId ?: c.id)
    for (p in newPool) ids.add(p.id)
    return ids
}

data class ContentSyncResult(
    val items: List<NewPoolItem>,
    val skipped: Int,
    val fetchedCount: Int,
    val errors: List<String>,
    val syncState: SyncState,
)

private suspend fun fetchSheetCsv(supabase: SupabaseClient, sourceUrl: String): String {
    val requestBody = buildJsonObject { put("url", sourceUrl) }.toString()
    val response: HttpResponse = supabase.functions.invoke("content-sync-proxy") {
        contentType(ContentType.Application.Json)
        setBody(requestBody)
    }
    val text = response.body<String>()
    if (!response.status.isSuccess()) {
        // Edge Function은 오류 시 { "error": "..." } JSON을 돌려준다(PC 웹과 동일 계약).
        val message = runCatching {
            Json.parseToJsonElement(text).let { it as JsonObject }["error"]?.jsonPrimitive?.content
        }.getOrNull()
        throw RuntimeException(message ?: "프록시 호출 실패 (HTTP ${response.status.value})")
    }
    return text
}

suspend fun runContentSync(
    supabase: SupabaseClient,
    sourceUrl: String,
    targetDeckId: String,
    cards: List<Card>,
    newPool: List<NewPoolItem>,
    syncState: SyncState,
): ContentSyncResult {
    val now = Instant.now().toString()
    val text = try {
        fetchSheetCsv(supabase, sourceUrl)
    } catch (err: Exception) {
        val message = err.message ?: err.toString()
        return ContentSyncResult(
            items = emptyList(),
            skipped = 0,
            fetchedCount = 0,
            errors = listOf("시트를 가져오지 못했습니다: $message"),
            syncState = syncState.copy(sourceUrl = sourceUrl, lastSyncAt = now, lastSyncResult = "실패: $message"),
        )
    }

    val (rows, errors) = parseCsv(text)
    val already = accountWideImportedIds(cards, newPool, syncState)
    val (items, skipped) = toNewPoolItems(rows, targetDeckId, already)

    val importedIds = (syncState.importedIds + items.map { it.id }).distinct()
    val resultSummary = if (errors.isNotEmpty()) {
        "${items.size}개 흡수, ${skipped}개 건너뜀, 형식 오류 ${errors.size}행"
    } else {
        "${items.size}개 흡수, ${skipped}개 건너뜀"
    }

    return ContentSyncResult(
        items = items,
        skipped = skipped,
        fetchedCount = rows.size,
        errors = errors,
        syncState = SyncState(sourceUrl = sourceUrl, importedIds = importedIds, lastSyncAt = now, lastSyncResult = resultSummary),
    )
}
