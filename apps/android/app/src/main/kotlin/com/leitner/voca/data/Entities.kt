package com.leitner.voca.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.leitner.voca.domain.Card
import com.leitner.voca.domain.Deck
import com.leitner.voca.domain.LapseMode
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.ReviewLog
import com.leitner.voca.domain.ReviewResult
import com.leitner.voca.domain.Settings
import com.leitner.voca.domain.SyncState

// DESIGN §2 로컬 엔티티를 Room(SQLite)에 저장하는 계층 — PC 웹 lib/db.ts(IndexedDB)와 대응.
// domain 패키지(Models.kt)는 순수 Kotlin 데이터클래스로 두고, Room 어노테이션은 여기 엔티티에만
// 붙인다 — 스케줄러/테스트가 저장소 세부사항과 무관하게 남도록.

@Entity(tableName = "decks")
data class DeckEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String?,
    val examDate: String?,
    val createdAt: String,
    val updatedAt: String?,
)

fun DeckEntity.toDomain() = Deck(id, name, description, examDate, createdAt, updatedAt)
fun Deck.toEntity() = DeckEntity(id, name, description, examDate, createdAt, updatedAt)

@Entity(tableName = "cards")
@TypeConverters(Converters::class)
data class CardEntity(
    @PrimaryKey val id: String,
    val deckId: String,
    val sourceId: String?,
    val promptKo: String,
    val answerEn: String,
    val chunkNote: String?,
    val audioUrl: String?,
    val box: Int,
    val nextReviewDate: String?,
    val lastReviewedAt: String?,
    val correctStreak: Int,
    val lapseCount: Int,
    val introducedAt: String,
    val tags: List<String>,
    val updatedAt: String?,
)

fun CardEntity.toDomain() = Card(
    id, deckId, sourceId, promptKo, answerEn, chunkNote, audioUrl,
    box, nextReviewDate, lastReviewedAt, correctStreak, lapseCount, introducedAt, tags, updatedAt,
)
fun Card.toEntity() = CardEntity(
    id, deckId, sourceId, promptKo, answerEn, chunkNote, audioUrl,
    box, nextReviewDate, lastReviewedAt, correctStreak, lapseCount, introducedAt, tags, updatedAt,
)

@Entity(tableName = "new_pool")
data class NewPoolEntity(
    @PrimaryKey val id: String,
    val deckId: String,
    val promptKo: String,
    val answerEn: String,
    val chunkNote: String?,
    val level: String?,
    val topic: String?,
    val importedAt: String,
)

fun NewPoolEntity.toDomain() = NewPoolItem(id, deckId, promptKo, answerEn, chunkNote, level, topic, importedAt)
fun NewPoolItem.toEntity() = NewPoolEntity(id, deckId, promptKo, answerEn, chunkNote, level, topic, importedAt)

@Entity(tableName = "review_log")
data class ReviewLogEntity(
    @PrimaryKey val id: String,
    val cardId: String,
    val date: String,
    val result: String, // "correct" | "wrong"
    val boxBefore: Int,
    val boxAfter: Int,
    val hintLevel: Int,
)

fun ReviewLogEntity.toDomain() = ReviewLog(
    id, cardId, date, if (result == "correct") ReviewResult.CORRECT else ReviewResult.WRONG, boxBefore, boxAfter, hintLevel,
)
fun ReviewLog.toEntity() = ReviewLogEntity(
    id, cardId, date, if (result == ReviewResult.CORRECT) "correct" else "wrong", boxBefore, boxAfter, hintLevel,
)

/** 설정은 단일 행(id 고정)으로 저장 — PC 웹 settingsRepo의 "singleton" 키와 같은 패턴. */
@Entity(tableName = "settings")
@TypeConverters(Converters::class)
data class SettingsEntity(
    @PrimaryKey val id: Int = 0,
    val intervals: List<Int>,
    val dailyGoal: Int,
    val reviewCap: Int,
    val newCap: Int,
    val maxActiveCards: Int,
    val lapseMode: String, // "soft" | "reset"
    val hintFreeLevel: Int,
    val notifyTime: String?,
    val recoveryEase: Boolean,
    val contentSourceUrl: String?,
    val contentSourceDeckId: String?,
    val autoSyncEnabled: Boolean,
    val refillThresholdDays: Int,
    val ttsAutoPlay: Boolean,
    val preferredAiModel: String = "claude",
    val updatedAt: String?,
)

fun SettingsEntity.toDomain() = Settings(
    intervals, dailyGoal, reviewCap, newCap, maxActiveCards,
    if (lapseMode == "soft") LapseMode.SOFT else LapseMode.RESET,
    hintFreeLevel, notifyTime, recoveryEase, contentSourceUrl, contentSourceDeckId, autoSyncEnabled,
    refillThresholdDays, ttsAutoPlay, preferredAiModel, updatedAt,
)
fun Settings.toEntity() = SettingsEntity(
    id = 0,
    intervals = intervals,
    dailyGoal = dailyGoal,
    reviewCap = reviewCap,
    newCap = newCap,
    maxActiveCards = maxActiveCards,
    lapseMode = if (lapseMode == LapseMode.SOFT) "soft" else "reset",
    hintFreeLevel = hintFreeLevel,
    notifyTime = notifyTime,
    recoveryEase = recoveryEase,
    contentSourceUrl = contentSourceUrl,
    contentSourceDeckId = contentSourceDeckId,
    autoSyncEnabled = autoSyncEnabled,
    updatedAt = updatedAt,
    refillThresholdDays = refillThresholdDays,
    ttsAutoPlay = ttsAutoPlay,
    preferredAiModel = preferredAiModel,
)

/** 2d — 콘텐츠 동기화 상태. Settings와 마찬가지로 단일 행(id 고정)으로 저장. */
@Entity(tableName = "sync_state")
@TypeConverters(Converters::class)
data class SyncStateEntity(
    @PrimaryKey val id: Int = 0,
    val sourceUrl: String?,
    val importedIds: List<String>,
    val lastSyncAt: String?,
    val lastSyncResult: String?,
)

fun SyncStateEntity.toDomain() = SyncState(sourceUrl, importedIds, lastSyncAt, lastSyncResult)
fun SyncState.toEntity() = SyncStateEntity(id = 0, sourceUrl = sourceUrl, importedIds = importedIds, lastSyncAt = lastSyncAt, lastSyncResult = lastSyncResult)

class Converters {
    @TypeConverter
    fun fromStringList(value: List<String>): String = value.joinToString("")

    @TypeConverter
    fun toStringList(value: String): List<String> = if (value.isEmpty()) emptyList() else value.split("")

    @TypeConverter
    fun fromIntList(value: List<Int>): String = value.joinToString(",")

    @TypeConverter
    fun toIntList(value: String): List<Int> = if (value.isEmpty()) emptyList() else value.split(",").map { it.toInt() }
}
