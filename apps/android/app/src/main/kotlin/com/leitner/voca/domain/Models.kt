package com.leitner.voca.domain

// packages/core/src/types.ts를 그대로 Kotlin으로 옮긴 것(DESIGN §2). 날짜는 웹과 동일하게
// ISO 문자열(YYYY-MM-DD)로 다룬다 — 기기 간 동기화(2c)에서 문자열 그대로 비교/저장하면 되도록.

enum class LapseMode { RESET, SOFT }

data class Deck(
    val id: String,
    val name: String,
    val description: String? = null,
    val examDate: String? = null, // D-day, ISO date
    val createdAt: String,
    val updatedAt: String? = null,
)

data class Card(
    val id: String,
    val deckId: String,
    val sourceId: String? = null,
    val promptKo: String,
    val answerEn: String,
    val chunkNote: String? = null,
    val audioUrl: String? = null,
    val box: Int, // 1~6, 7=졸업
    val nextReviewDate: String?, // 졸업(box=7)이면 null
    val lastReviewedAt: String?,
    val correctStreak: Int,
    val lapseCount: Int,
    val introducedAt: String,
    val tags: List<String> = emptyList(),
    val updatedAt: String? = null,
)

data class NewPoolItem(
    val id: String, // = 원천 시트 id
    val deckId: String,
    val promptKo: String,
    val answerEn: String,
    val chunkNote: String? = null,
    val level: String? = null,
    val topic: String? = null,
    val importedAt: String,
)

enum class ReviewResult { CORRECT, WRONG }

data class ReviewLog(
    val id: String,
    val cardId: String,
    val date: String,
    val result: ReviewResult,
    val boxBefore: Int,
    val boxAfter: Int,
    val hintLevel: Int,
)

data class Settings(
    val intervals: List<Int> = listOf(1, 2, 4, 8, 16, 32),
    val dailyGoal: Int = 30, // 하루 복습 목표(완료 표시·진척도 기준). 넘겨서 더 풀어도 됨. 신규 유입 억제 기준도 겸함.
    val newCap: Int = 8,
    val maxActiveCards: Int = 150, // 박스1~6 누적 상한(WIP cap). DESIGN §1.4 — 이전에 Android에서 누락돼있던 걸 2d에서 같이 포팅.
    val lapseMode: LapseMode = LapseMode.SOFT,
    val hintFreeLevel: Int = 1,
    val notifyTime: String? = null,
    val recoveryEase: Boolean = false,
    val contentSourceUrl: String? = null, // 2d — 구글시트 공유 링크
    val contentSourceDeckId: String? = null, // 2d — 흡수한 문장이 들어갈 대상 덱
    val autoSyncEnabled: Boolean = false, // 2d
    val refillThresholdDays: Int = 3,
    val ttsAutoPlay: Boolean = false,
    val preferredAiModel: String = "claude", // DESIGN §6 '선생님한테 질문' 모델(claude|gemini|gpt)
    val updatedAt: String? = null, // 2c 클라우드 동기화 LWW 기준(DESIGN §3.7).
) {
    companion object {
        val DEFAULT = Settings()
    }
}

/** 2d — 콘텐츠 동기화 진행 상태(packages/core SyncState 포팅). 계정당 1행, PC 웹과 sync_state 테이블 공유. */
data class SyncState(
    val sourceUrl: String? = null,
    val importedIds: List<String> = emptyList(),
    val lastSyncAt: String? = null,
    val lastSyncResult: String? = null,
) {
    companion object {
        val DEFAULT = SyncState()
    }
}

const val GRADUATED_BOX = 7
const val NEW_CARD_BOX = 0 // DESIGN §1.3b — 신규 도입 직후, 복습 기한 없음(항상 due)
const val LEECH_LAPSE_THRESHOLD = 5
