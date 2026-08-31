package com.leitner.voca.data

import com.leitner.voca.domain.Card
import com.leitner.voca.domain.Deck
import com.leitner.voca.domain.LapseMode
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.Settings
import com.leitner.voca.domain.SyncState
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// PC 웹 lib/sync.ts의 row 매핑을 그대로 Kotlin으로 옮긴 것 — supabase/schema.sql 테이블
// 컬럼(snake_case)과 1:1 대응. PC와 같은 테이블을 쓰므로 컬럼명이 어긋나면 동기화가 깨진다.

@Serializable
data class DeckRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    val name: String,
    val description: String? = null,
    @SerialName("exam_date") val examDate: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String? = null,
)

fun Deck.toRow(userId: String) = DeckRow(id, userId, name, description, examDate, createdAt, updatedAt ?: createdAt)
fun DeckRow.toDomain() = Deck(id, name, description, examDate, createdAt, updatedAt)

@Serializable
data class CardRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("deck_id") val deckId: String,
    @SerialName("source_id") val sourceId: String? = null,
    @SerialName("prompt_ko") val promptKo: String,
    @SerialName("answer_en") val answerEn: String,
    @SerialName("chunk_note") val chunkNote: String? = null,
    @SerialName("audio_url") val audioUrl: String? = null,
    val box: Int,
    @SerialName("next_review_date") val nextReviewDate: String? = null,
    @SerialName("last_reviewed_at") val lastReviewedAt: String? = null,
    @SerialName("correct_streak") val correctStreak: Int,
    @SerialName("lapse_count") val lapseCount: Int,
    @SerialName("introduced_at") val introducedAt: String,
    val tags: List<String> = emptyList(),
    @SerialName("updated_at") val updatedAt: String? = null,
)

fun Card.toRow(userId: String) = CardRow(
    id, userId, deckId, sourceId, promptKo, answerEn, chunkNote, audioUrl,
    box, nextReviewDate, lastReviewedAt, correctStreak, lapseCount, introducedAt, tags, updatedAt,
)
fun CardRow.toDomain() = Card(
    id, deckId, sourceId, promptKo, answerEn, chunkNote, audioUrl,
    box, nextReviewDate, lastReviewedAt, correctStreak, lapseCount, introducedAt, tags, updatedAt,
)

@Serializable
data class NewPoolRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("deck_id") val deckId: String,
    @SerialName("prompt_ko") val promptKo: String,
    @SerialName("answer_en") val answerEn: String,
    @SerialName("chunk_note") val chunkNote: String? = null,
    val level: String? = null,
    val topic: String? = null,
    val status: String = "pending",
    @SerialName("imported_at") val importedAt: String,
)

fun NewPoolItem.toRow(userId: String) = NewPoolRow(id, userId, deckId, promptKo, answerEn, chunkNote, level, topic, "pending", importedAt)
fun NewPoolRow.toDomain() = NewPoolItem(id, deckId, promptKo, answerEn, chunkNote, level, topic, importedAt)

@Serializable
data class SettingsRow(
    @SerialName("user_id") val userId: String,
    val intervals: List<Int>,
    @SerialName("daily_goal") val dailyGoal: Int,
    @SerialName("review_cap") val reviewCap: Int,
    @SerialName("new_cap") val newCap: Int,
    @SerialName("max_active_cards") val maxActiveCards: Int,
    @SerialName("lapse_mode") val lapseMode: String,
    @SerialName("hint_free_level") val hintFreeLevel: Int,
    @SerialName("notify_time") val notifyTime: String? = null,
    @SerialName("recovery_ease") val recoveryEase: Boolean,
    @SerialName("content_source_url") val contentSourceUrl: String? = null,
    @SerialName("auto_sync_enabled") val autoSyncEnabled: Boolean = false,
    @SerialName("refill_threshold_days") val refillThresholdDays: Int,
    @SerialName("tts_auto_play") val ttsAutoPlay: Boolean,
    @SerialName("preferred_ai_model") val preferredAiModel: String = "claude",
    @SerialName("updated_at") val updatedAt: String? = null,
)

// contentSourceDeckId는 PC 웹과 마찬가지로 클라우드에 올리지 않는 로컬 전용 필드다(schema.sql
// settings 테이블에 컬럼 자체가 없음 — 시트 1개=덱 1개 매핑을 기기마다 다르게 둬도 되게).
fun Settings.toRow(userId: String) = SettingsRow(
    userId, intervals, dailyGoal, reviewCap, newCap, maxActiveCards,
    if (lapseMode == LapseMode.SOFT) "soft" else "reset",
    hintFreeLevel, notifyTime, recoveryEase, contentSourceUrl, autoSyncEnabled, refillThresholdDays, ttsAutoPlay,
    preferredAiModel,
    updatedAt ?: java.time.Instant.now().toString(),
)
fun SettingsRow.toDomain(existingContentSourceDeckId: String? = null) = Settings(
    intervals, dailyGoal, reviewCap, newCap, maxActiveCards,
    if (lapseMode == "soft") LapseMode.SOFT else LapseMode.RESET,
    hintFreeLevel, notifyTime, recoveryEase, contentSourceUrl, existingContentSourceDeckId, autoSyncEnabled,
    refillThresholdDays, ttsAutoPlay, preferredAiModel, updatedAt,
)

@Serializable
data class SyncStateRow(
    @SerialName("user_id") val userId: String,
    @SerialName("source_url") val sourceUrl: String? = null,
    @SerialName("imported_ids") val importedIds: List<String> = emptyList(),
    @SerialName("last_sync_at") val lastSyncAt: String? = null,
    @SerialName("last_sync_result") val lastSyncResult: String? = null,
)

fun SyncState.toRow(userId: String) = SyncStateRow(userId, sourceUrl, importedIds, lastSyncAt, lastSyncResult)
fun SyncStateRow.toDomain() = SyncState(sourceUrl, importedIds, lastSyncAt, lastSyncResult)
