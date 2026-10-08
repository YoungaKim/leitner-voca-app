package com.leitner.voca.data

import com.leitner.voca.domain.Card
import com.leitner.voca.domain.Deck
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.ReviewLog
import com.leitner.voca.domain.Settings
import com.leitner.voca.domain.SyncState
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.*

// 서버가 계정의 공통 학습 상태를 관리하고 Room은 캐시로 사용한다.

data class CloudSnapshot(
    val decks: List<Deck>,
    val cards: List<Card>,
    val newPool: List<NewPoolItem>,
    val settings: Settings?,
    val reviewLog: List<ReviewLog> = emptyList(),
)

class SyncRepository(private val supabase: SupabaseClient) {

    suspend fun pushDeck(userId: String, deck: Deck) {
        supabase.postgrest["decks"].upsert(deck.toRow(userId))
    }

    suspend fun pushCard(userId: String, card: Card, create: Boolean = false) {
        if (create) supabase.postgrest["cards"].insert(card.toRow(userId))
        else {
            val rows = supabase.postgrest["cards"].update({
                set("prompt_ko", card.promptKo); set("answer_en", card.answerEn)
                set("chunk_note", card.chunkNote); set("updated_at", card.updatedAt)
            }) { filter { eq("user_id", userId); eq("id", card.id) }; select() }.decodeList<CardRow>()
            check(rows.isNotEmpty()) { "Card removed. Sync and retry." }
        }
    }

    suspend fun deleteCardRemote(userId: String, id: String) {
        supabase.postgrest["cards"].delete { filter { eq("user_id", userId); eq("id", id) } }
    }

    suspend fun deleteDeckRemote(userId: String, id: String) {
        // decks 삭제 시 cards/new_pool은 schema.sql의 FK on delete cascade가 처리한다.
        supabase.postgrest["decks"].delete { filter { eq("user_id", userId); eq("id", id) } }
    }

    suspend fun pushPoolItems(userId: String, items: List<NewPoolItem>) {
        if (items.isEmpty()) return
        supabase.postgrest["new_pool"].upsert(items.map { it.toRow(userId) })
    }

    suspend fun pushSettings(userId: String, settings: Settings) {
        supabase.postgrest["settings"].upsert(settings.toRow(userId))
    }

    /** 콘텐츠 가져오기 진행 상태도 같은 계정의 기기들이 공유한다. */
    suspend fun pushSyncState(userId: String, state: SyncState) {
        supabase.postgrest["sync_state"].upsert(state.toRow(userId))
    }

    // Stable pagination avoids silently truncating cards/pool/logs at the API row limit.
    private suspend inline fun <reified T : Any> readRows(table: String, userId: String, pending: Boolean = false): List<T> {
        val rows = mutableListOf<T>()
        var offset = 0L
        while (true) {
            val page = supabase.postgrest[table].select {
                filter { eq("user_id", userId); if (pending) eq("status", "pending") }
                order("id", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                range(offset, offset + 499)
            }.decodeList<T>()
            rows.addAll(page)
            if (page.size < 500) return rows
            offset += 500
        }
    }

    suspend fun introduceCard(userId: String, card: Card, poolId: String): Card =
        supabase.postgrest.rpc("introduce_shared_card", buildJsonObject {
            put("card_data", Json.encodeToJsonElement(card.toRow(userId)))
            put("pool_id", poolId)
        }).decodeAs<CardRow>().toDomain()

    suspend fun saveReview(userId: String, card: Card, log: ReviewLog, expectedUpdatedAt: String?) {
        supabase.postgrest.rpc("save_shared_review", buildJsonObject {
            put("card_data", Json.encodeToJsonElement(card.toRow(userId)))
            put("log_data", Json.encodeToJsonElement(log.toRow(userId)))
            put("expected_updated_at", expectedUpdatedAt?.let { JsonPrimitive(it) } ?: JsonNull)
        })
    }

    /** Server is authoritative. A cache read must never resurrect removed cards/pool. */
    suspend fun fullSync(userId: String, local: CloudSnapshot): CloudSnapshot {
        val decks = readRows<DeckRow>("decks", userId).map { it.toDomain() }
        val cards = readRows<CardRow>("cards", userId).map { it.toDomain() }
        val consumed = cards.map { it.sourceId ?: it.id }.toSet()
        val pool = readRows<NewPoolRow>("new_pool", userId, true).map { it.toDomain() }.filter { it.id !in consumed }
        val row = supabase.postgrest["settings"].select { filter { eq("user_id", userId) } }.decodeSingleOrNull<SettingsRow>()
        val legacyTarget = local.settings?.contentSourceDeckId?.takeIf { target -> decks.any { it.id == target } }
        if (row != null && row.contentSourceDeckId == null && legacyTarget != null) {
            supabase.postgrest["settings"].update({ set("content_source_deck_id", legacyTarget) }) { filter { eq("user_id", userId) } }
        }
        val settings = row?.toDomain(legacyTarget) ?: Settings.DEFAULT
        val logs = readRows<ReviewLogRow>("review_log", userId).map { it.toDomain() }
        return CloudSnapshot(decks, cards, pool, settings, logs)
    }

    suspend fun pullSyncState(userId: String): SyncState = supabase.postgrest["sync_state"].select {
        filter { eq("user_id", userId) }
    }.decodeSingleOrNull<SyncStateRow>()?.toDomain() ?: SyncState.DEFAULT
}
