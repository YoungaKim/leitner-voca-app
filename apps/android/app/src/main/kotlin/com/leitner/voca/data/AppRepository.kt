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
import androidx.room.withTransaction
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.UUID

// 로그인된 계정은 서버 저장에 성공한 뒤 Room 캐시를 갱신한다.
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

    private val dataMutex = Mutex()

    // Online writes must succeed before committing the local cache or advancing a review.
    private suspend fun mirror(block: suspend (userId: String) -> Unit) {
        val userId = auth.currentUserId() ?: error("로그인이 필요합니다.")
        block(userId)
    }

    suspend fun addDeck(name: String, description: String? = null, examDate: String? = null): Deck = dataMutex.withLock {
        val now = Instant.now().toString()
        val deck = Deck(id = UUID.randomUUID().toString(), name = name, description = description, examDate = examDate, createdAt = now, updatedAt = now)
        mirror { userId -> sync.pushDeck(userId, deck) }
        db.deckDao().upsert(deck.toEntity())

        deck
    }

    /** 덱 삭제 + 딸린 카드/저수지 항목까지 cascade(PC 웹 store.ts deleteDeck과 동일 의도).
     * 클라우드 쪽은 schema.sql의 FK on delete cascade가 알아서 처리한다. */
    suspend fun deleteDeck(id: String) = dataMutex.withLock {
        mirror { userId -> sync.deleteDeckRemote(userId, id) }
        db.cardDao().deleteByDeck(id)
        db.newPoolDao().deleteByDeck(id)
        db.deckDao().delete(id)

    }

    suspend fun addCard(deckId: String, promptKo: String, answerEn: String, chunkNote: String?, today: String): Card = dataMutex.withLock {
        val now = Instant.now().toString()
        val card = Card(
            id = UUID.randomUUID().toString(), deckId = deckId, promptKo = promptKo, answerEn = answerEn,
            // 수작업 추가 카드도 저수지 도입과 동일하게 박스0(신규)으로 시작(DESIGN §1.3b).
            chunkNote = chunkNote, box = NEW_CARD_BOX, nextReviewDate = today, lastReviewedAt = null,
            correctStreak = 0, lapseCount = 0, introducedAt = today, tags = emptyList(), updatedAt = now,
        )
        mirror { userId -> sync.pushCard(userId, card, true) }
        db.cardDao().upsert(card.toEntity())

        card
    }

    suspend fun updateCard(card: Card) = dataMutex.withLock {
        val updated = card.copy(updatedAt = Instant.now().toString())
        mirror { userId -> sync.pushCard(userId, updated) }
        db.cardDao().upsert(updated.toEntity())

    }

    suspend fun deleteCard(id: String) = dataMutex.withLock {
        mirror { userId -> sync.deleteCardRemote(userId, id) }
        db.cardDao().delete(id)

    }

    suspend fun importNewPoolItems(items: List<NewPoolItem>) = dataMutex.withLock {
        if (items.isEmpty()) return@withLock
        mirror { userId -> sync.pushPoolItems(userId, items) }
        db.newPoolDao().upsertAll(items.map { it.toEntity() })

    }

    suspend fun applyReview(updated: Card, log: ReviewLog) = dataMutex.withLock {
        val card = updated.copy(updatedAt = Instant.now().toString())
        mirror { userId -> sync.saveReview(userId, card, log, cards.first().find { it.id == card.id }?.updatedAt) }
        db.cardDao().upsert(card.toEntity())
        db.reviewLogDao().insert(log.toEntity())

    }

    suspend fun introduceCard(card: Card, poolId: String) = dataMutex.withLock {
        val withTimestamp = sync.introduceCard(auth.currentUserId() ?: error("로그인이 필요합니다."), card.copy(updatedAt = Instant.now().toString()), poolId)
        db.cardDao().upsert(withTimestamp.toEntity())
        db.newPoolDao().delete(poolId)

    }

    suspend fun updateSettings(settings: Settings) = dataMutex.withLock {
        val updated = settings.copy(updatedAt = Instant.now().toString())
        mirror { userId -> sync.pushSettings(userId, updated) }
        db.settingsDao().upsert(updated.toEntity())

    }

    /** 2d — "지금 동기화": 구글시트에서 새 문장을 읽어와 저수지에 흡수하고, 진행 상태를 저장한다.
     * PC 웹 store.ts syncContentNow와 동일 절차. 오류가 나도 로컬 데이터는 절대 건드리지 않는다. */
    suspend fun syncContentNow(sourceUrl: String, targetDeckId: String): ContentSyncResult {
        val result = runContentSync(supabase, sourceUrl, targetDeckId, cards.first(), newPool.first(), syncState.first())
        if (result.items.isNotEmpty()) importNewPoolItems(result.items)
        mirror { userId -> sync.pushSyncState(userId, result.syncState) }
        db.syncStateDao().upsert(result.syncState.toEntity())

        return result
    }

    /** DESIGN §6 '선생님한테 질문' — 카드 컨텍스트 기반 1회성 Q&A(저장 안 함). */
    suspend fun askTeacher(model: String, question: String, context: AskTeacherContext): String =
        requestAskTeacher(supabase, model, question, context)

    /** 로그인 직후 1회 호출 — 클라우드와 병합해 로컬(Room)을 덮어쓴다(PC 웹 store.ts mergeFromCloud). */
    suspend fun mergeFromCloud(userId: String) = dataMutex.withLock {
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
        val sharedSyncState = sync.pullSyncState(userId)
        // Preserve the pre-migration cache in private preferences for recovery; never upload it.
        if (!prefs.contains("before_cloud_authority")) {
            val backup = kotlinx.serialization.json.buildJsonObject {
                put("decks", Json.encodeToJsonElement(local.decks.map { it.toRow(userId) }))
                put("cards", Json.encodeToJsonElement(local.cards.map { it.toRow(userId) }))
                put("pool", Json.encodeToJsonElement(local.newPool.map { it.toRow(userId) }))
                put("logs", Json.encodeToJsonElement(local.reviewLog.map { it.toRow(userId) }))
            }
            check(prefs.edit().putString("before_cloud_authority", backup.toString()).commit())
        }
        db.withTransaction {
            db.cardDao().clear()
            db.newPoolDao().clear()
            db.deckDao().clear()
            db.reviewLogDao().clear()
            merged.decks.forEach { db.deckDao().upsert(it.toEntity()) }
            db.cardDao().upsertAll(merged.cards.map { it.toEntity() })
            db.newPoolDao().upsertAll(merged.newPool.map { it.toEntity() })
            db.reviewLogDao().insertAll(merged.reviewLog.map { it.toEntity() })
            merged.settings?.let { db.settingsDao().upsert(it.toEntity()) }
            db.syncStateDao().upsert(sharedSyncState.toEntity())
        }
        prefs.edit().putString(LAST_SYNCED_USER_KEY, userId).apply()
    }

    suspend fun refreshFromCloud() {
        mergeFromCloud(auth.currentUserId() ?: error("로그인이 필요합니다."))
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
