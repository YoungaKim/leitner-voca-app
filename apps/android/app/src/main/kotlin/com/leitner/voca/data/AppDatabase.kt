package com.leitner.voca.data

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        DeckEntity::class, CardEntity::class, NewPoolEntity::class, ReviewLogEntity::class,
        SettingsEntity::class, SyncStateEntity::class,
    ],
    version = 5, // v5: Settings에서 reviewCap 제거(복습 상한 폐지 — 오늘 due는 상한 없이 전부 큐에). fallbackToDestructiveMigration로 로컬 재생성.
    // v4: Settings에 ttsAutoPlay(듣기 자동재생)/preferredAiModel(선생님한테 질문) 추가
    // v3: 2d — Settings에 maxActiveCards/contentSourceUrl/contentSourceDeckId/autoSyncEnabled 추가 + sync_state 테이블 신설
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun deckDao(): DeckDao
    abstract fun cardDao(): CardDao
    abstract fun newPoolDao(): NewPoolDao
    abstract fun reviewLogDao(): ReviewLogDao
    abstract fun settingsDao(): SettingsDao
    abstract fun syncStateDao(): SyncStateDao
}
