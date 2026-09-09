package com.leitner.voca.data

import com.leitner.voca.domain.Card
import com.leitner.voca.domain.Deck
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.ReviewLog
import com.leitner.voca.domain.Settings
import com.leitner.voca.domain.SyncState
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest

// 2c — PC 웹 lib/sync.ts 포팅. 로컬(Room) ↔ Supabase 클라우드 동기화. updatedAt 기준 LWW로
// 병합한다(DESIGN §3.7). "같은 계정이면 폰/PC가 같은 학습 상태를 공유"가 이 파일의 목적.

/** id 기준 합집합, 같은 id면 updatedAt이 더 최신인 쪽이 이긴다 — PC 웹 sync.ts의 mergeByUpdatedAt과 동일 규칙. */
fun <T> mergeByUpdatedAt(local: List<T>, remote: List<T>, id: (T) -> String, updatedAt: (T) -> String?): List<T> {
    val byId = LinkedHashMap<String, T>()
    for (item in local) byId[id(item)] = item
    for (item in remote) {
        val existing = byId[id(item)]
        if (existing == null) {
            byId[id(item)] = item
            continue
        }
        val existingTime = updatedAt(existing)?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() }
        val incomingTime = updatedAt(item)?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() }
        if (incomingTime != null && (existingTime == null || incomingTime > existingTime)) byId[id(item)] = item
    }
    return byId.values.toList()
}

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

    suspend fun pushCard(userId: String, card: Card) {
        supabase.postgrest["cards"].upsert(card.toRow(userId))
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

    suspend fun deletePoolItemRemote(userId: String, id: String) {
        supabase.postgrest["new_pool"].delete { filter { eq("user_id", userId); eq("id", id) } }
    }

    suspend fun pushSettings(userId: String, settings: Settings) {
        supabase.postgrest["settings"].upsert(settings.toRow(userId))
    }

    suspend fun pushReviewLogs(userId: String, logs: List<ReviewLog>) {
        if (logs.isEmpty()) return
        supabase.postgrest["review_log"].upsert(logs.map { it.toRow(userId) })
    }

    /** 2d — 콘텐츠 동기화 진행 상태 백업. PC 웹과 마찬가지로 로그인 시 pull-병합 대상에는 안 넣는다
     * (기기별 진행 상태를 서로 덮어쓰지 않도록) — push만으로 클라우드에 최신 상태를 남겨둔다. */
    suspend fun pushSyncState(userId: String, state: SyncState) {
        supabase.postgrest["sync_state"].upsert(state.toRow(userId))
    }

    private suspend fun pullAll(userId: String): CloudSnapshot {
        val decks = supabase.postgrest["decks"].select { filter { eq("user_id", userId) } }
            .decodeList<DeckRow>().map { it.toDomain() }
        val cards = supabase.postgrest["cards"].select { filter { eq("user_id", userId) } }
            .decodeList<CardRow>().map { it.toDomain() }
        val pool = supabase.postgrest["new_pool"].select {
            filter { eq("user_id", userId); eq("status", "pending") }
        }.decodeList<NewPoolRow>().map { it.toDomain() }
        val settings = supabase.postgrest["settings"].select { filter { eq("user_id", userId) } }
            .decodeSingleOrNull<SettingsRow>()?.toDomain()
        val reviewLog = supabase.postgrest["review_log"].select { filter { eq("user_id", userId) } }
            .decodeList<ReviewLogRow>().map { it.toDomain() }
        return CloudSnapshot(decks, cards, pool, settings, reviewLog)
    }

    /** 로그인 직후 1회 호출 — 클라우드와 병합해 병합 결과를 반환하고, 병합본을 다시 클라우드에도
     * 반영한다(양쪽에 한쪽에만 있던 데이터가 상대에도 생기도록). 로컬 저장은 호출부(Repository)가 한다. */
    suspend fun fullSync(userId: String, local: CloudSnapshot): CloudSnapshot {
        val remote = pullAll(userId)
        val decks = mergeByUpdatedAt(local.decks, remote.decks, { it.id }, { it.updatedAt })
        val cards = mergeByUpdatedAt(local.cards, remote.cards, { it.id }, { it.updatedAt })
        val cardIds = cards.map { it.sourceId ?: it.id }.toSet()
        val poolById = LinkedHashMap<String, NewPoolItem>()
        for (p in local.newPool + remote.newPool) {
            if (p.id in cardIds) continue // 이미 카드로 승격된 저수지 항목은 제외
            poolById[p.id] = p
        }
        val settings = when {
            remote.settings == null -> local.settings ?: Settings.DEFAULT
            local.settings?.updatedAt == null -> remote.settings
            (remote.settings.updatedAt ?: "") > (local.settings.updatedAt ?: "") -> remote.settings
            else -> local.settings
        }
            // contentSourceDeckId는 클라우드에 안 올라가는 로컬 전용 필드라(위 pushSettings/pullAll 참고)
            // LWW로 원격이 이겨도 이 기기가 알던 값을 잃으면 안 된다.
            .let { it.copy(contentSourceDeckId = it.contentSourceDeckId ?: local.settings?.contentSourceDeckId) }

        // append-only — id 합집합만(양쪽 어디에 있든 다 살린다).
        val reviewLogById = LinkedHashMap<String, ReviewLog>()
        for (l in remote.reviewLog + local.reviewLog) reviewLogById[l.id] = l
        val reviewLog = reviewLogById.values.toList()

        val merged = CloudSnapshot(decks, cards, poolById.values.toList(), settings, reviewLog)
        if (merged.decks.isNotEmpty()) supabase.postgrest["decks"].upsert(merged.decks.map { it.toRow(userId) })
        if (merged.cards.isNotEmpty()) supabase.postgrest["cards"].upsert(merged.cards.map { it.toRow(userId) })
        if (merged.newPool.isNotEmpty()) supabase.postgrest["new_pool"].upsert(merged.newPool.map { it.toRow(userId) })
        if (merged.reviewLog.isNotEmpty()) supabase.postgrest["review_log"].upsert(merged.reviewLog.map { it.toRow(userId) })
        supabase.postgrest["settings"].upsert(merged.settings!!.toRow(userId))
        return merged
    }
}
