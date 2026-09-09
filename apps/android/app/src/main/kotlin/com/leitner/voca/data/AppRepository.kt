package com.leitner.voca.data

import android.content.Context
import com.leitner.voca.domain.Card
import com.leitner.voca.domain.Deck
import com.leitner.voca.domain.NEW_CARD_BOX
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.ReviewLog
import com.leitner.voca.domain.Settings
import com.leitner.voca.domain.SyncState
import io.github.jan.supabase.SupabaseClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

// PC 웹 store.ts와 대응되는 리포지토리. 2c부터 로그인 상태면 로컬 저장과 동시에 클라우드에도
// 반영한다(write-through, PC 웹과 동일 원칙) — 실패해도 로컬 저장은 이미 끝났으니 UI는 안 막고,
// 다음 fullSync에서 다시 맞춰진다.
class AppRepository(
    private val db: AppDatabase,
    private val auth: AuthRepository,
    private val sync: SyncRepository,
    private val supabase: SupabaseClient,
    context: Context,
) {
    // PC 웹 store.ts의 LAST_SYNCED_USER_KEY(localStorage)와 같은 역할 — 이 기기에 마지막으로
    // 로그인했던 계정을 기억해뒀다가, 다른 계정으로 로그인하면 로컬 캐시가 섞이지 않도록 먼저 비운다.
    private val prefs = context.getSharedPreferences("voca_sync", Context.MODE_PRIVATE)
    val decks: Flow<List<Deck>> = db.deckDao().observeAll().map { list -> list.map { it.toDomain() } }
    val cards: Flow<List<Card>> = db.cardDao().observeAll().map { list -> list.map { it.toDomain() } }
    val newPool: Flow<List<NewPoolItem>> = db.newPoolDao().observeAll().map { list -> list.map { it.toDomain() } }
    val settings: Flow<Settings> = db.settingsDao().observe().map { it?.toDomain() ?: Settings.DEFAULT }
    val syncState: Flow<SyncState> = db.syncStateDao().observe().map { it?.toDomain() ?: SyncState.DEFAULT }

    // 앱 생명주기 동안 살아있는 백그라운드 스코프 — write-through는 UI를 기다리게 하면 안 돼서
    // (PC 웹 mirrorToCloud와 동일 원칙) 별도 스코프에서 fire-and-forget으로 던진다.
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun mirror(block: suspend (userId: String) -> Unit) {
        val userId = auth.currentUserId() ?: return
        backgroundScope.launch { runCatching { block(userId) } }
    }

    suspend fun addDeck(name: String, description: String? = null, examDate: String? = null): Deck {
        val now = Instant.now().toString()
        val deck = Deck(id = UUID.randomUUID().toString(), name = name, description = description, examDate = examDate, createdAt = now, updatedAt = now)
        db.deckDao().upsert(deck.toEntity())
        mirror { userId -> sync.pushDeck(userId, deck) }
        return deck
    }

    /** 덱 삭제 + 딸린 카드/저수지 항목까지 cascade(PC 웹 store.ts deleteDeck과 동일 의도).
     * 클라우드 쪽은 schema.sql의 FK on delete cascade가 알아서 처리한다. */
    suspend fun deleteDeck(id: String) {
        db.cardDao().deleteByDeck(id)
        db.newPoolDao().deleteByDeck(id)
        db.deckDao().delete(id)
        mirror { userId -> sync.deleteDeckRemote(userId, id) }
    }

    suspend fun addCard(deckId: String, promptKo: String, answerEn: String, chunkNote: String?, today: String): Card {
        val now = Instant.now().toString()
        val card = Card(
            id = UUID.randomUUID().toString(), deckId = deckId, promptKo = promptKo, answerEn = answerEn,
            // 수작업 추가 카드도 저수지 도입과 동일하게 박스0(신규)으로 시작(DESIGN §1.3b).
            chunkNote = chunkNote, box = NEW_CARD_BOX, nextReviewDate = today, lastReviewedAt = null,
            correctStreak = 0, lapseCount = 0, introducedAt = today, tags = emptyList(), updatedAt = now,
        )
        db.cardDao().upsert(card.toEntity())
        mirror { userId -> sync.pushCard(userId, card) }
        return card
    }

    suspend fun updateCard(card: Card) {
        val updated = card.copy(updatedAt = Instant.now().toString())
        db.cardDao().upsert(updated.toEntity())
        mirror { userId -> sync.pushCard(userId, updated) }
    }

    suspend fun deleteCard(id: String) {
        db.cardDao().delete(id)
        mirror { userId -> sync.deleteCardRemote(userId, id) }
    }

    suspend fun importNewPoolItems(items: List<NewPoolItem>) {
        if (items.isEmpty()) return
        db.newPoolDao().upsertAll(items.map { it.toEntity() })
        mirror { userId -> sync.pushPoolItems(userId, items) }
    }

    suspend fun applyReview(updated: Card, log: ReviewLog) {
        val card = updated.copy(updatedAt = Instant.now().toString())
        db.cardDao().upsert(card.toEntity())
        db.reviewLogDao().insert(log.toEntity())
        mirror { userId ->
            sync.pushCard(userId, card)
            sync.pushReviewLogs(userId, listOf(log))
        }
    }

    suspend fun introduceCard(card: Card, poolId: String) {
        val withTimestamp = card.copy(updatedAt = Instant.now().toString())
        db.cardDao().upsert(withTimestamp.toEntity())
        db.newPoolDao().delete(poolId)
        mirror { userId ->
            sync.pushCard(userId, withTimestamp)
            sync.deletePoolItemRemote(userId, poolId)
        }
    }

    suspend fun updateSettings(settings: Settings) {
        val updated = settings.copy(updatedAt = Instant.now().toString())
        db.settingsDao().upsert(updated.toEntity())
        mirror { userId -> sync.pushSettings(userId, updated) }
    }

    /** 2d — "지금 동기화": 구글시트에서 새 문장을 읽어와 저수지에 흡수하고, 진행 상태를 저장한다.
     * PC 웹 store.ts syncContentNow와 동일 절차. 오류가 나도 로컬 데이터는 절대 건드리지 않는다. */
    suspend fun syncContentNow(sourceUrl: String, targetDeckId: String): ContentSyncResult {
        val result = runContentSync(supabase, sourceUrl, targetDeckId, cards.first(), newPool.first(), syncState.first())
        if (result.items.isNotEmpty()) importNewPoolItems(result.items)
        db.syncStateDao().upsert(result.syncState.toEntity())
        mirror { userId -> sync.pushSyncState(userId, result.syncState) }
        return result
    }

    /** DESIGN §6 '선생님한테 질문' — 카드 컨텍스트 기반 1회성 Q&A(저장 안 함). */
    suspend fun askTeacher(model: String, question: String, context: AskTeacherContext): String =
        requestAskTeacher(supabase, model, question, context)

    /** 로그인 직후 1회 호출 — 클라우드와 병합해 로컬(Room)을 덮어쓴다(PC 웹 store.ts mergeFromCloud). */
    suspend fun mergeFromCloud(userId: String) {
        // 이 기기에 마지막으로 로그인했던 계정과 다르면, 이전 계정의 로컬 캐시가 새 계정 데이터와
        // 섞이거나(심지어 클라우드로 push까지 돼) 계정 간 데이터가 오염되므로 병합 전에 로컬을
        // 완전히 비운다(PC 웹 store.ts mergeFromCloud와 동일 로직).
        val lastUserId = prefs.getString(LAST_SYNCED_USER_KEY, null)
        if (lastUserId != null && lastUserId != userId) clearAllLocal()

        val local = CloudSnapshot(
            decks.first(), cards.first(), newPool.first(), settings.first(),
            db.reviewLogDao().getAll().map { it.toDomain() },
        )
        val merged = sync.fullSync(userId, local)
        merged.decks.forEach { db.deckDao().upsert(it.toEntity()) }
        db.cardDao().upsertAll(merged.cards.map { it.toEntity() })
        db.newPoolDao().upsertAll(merged.newPool.map { it.toEntity() })
        db.reviewLogDao().insertAll(merged.reviewLog.map { it.toEntity() })
        merged.settings?.let { db.settingsDao().upsert(it.toEntity()) }
        prefs.edit().putString(LAST_SYNCED_USER_KEY, userId).apply()
    }

    /** 로그아웃/계정 전환 시 — 클라우드에 이미 저장돼 있으니 로컬 캐시만 비운다(PC 웹 resetLocal과 동일). */
    suspend fun clearAllLocal() {
        db.cardDao().clear()
        db.newPoolDao().clear()
        db.deckDao().clear()
        db.reviewLogDao().clear()
        db.settingsDao().clear()
        db.syncStateDao().clear()
        prefs.edit().remove(LAST_SYNCED_USER_KEY).apply()
    }

    private companion object {
        const val LAST_SYNCED_USER_KEY = "last_synced_user_id"
    }
}
