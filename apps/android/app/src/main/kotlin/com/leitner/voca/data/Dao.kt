package com.leitner.voca.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface DeckDao {
    @Query("SELECT * FROM decks")
    fun observeAll(): Flow<List<DeckEntity>>

    @Upsert
    suspend fun upsert(deck: DeckEntity)

    @Query("DELETE FROM decks WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM decks")
    suspend fun clear()
}

@Dao
interface CardDao {
    @Query("SELECT * FROM cards")
    fun observeAll(): Flow<List<CardEntity>>

    @Upsert
    suspend fun upsert(card: CardEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(cards: List<CardEntity>)

    @Query("DELETE FROM cards WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM cards WHERE deckId = :deckId")
    suspend fun deleteByDeck(deckId: String)

    @Query("DELETE FROM cards")
    suspend fun clear()
}

@Dao
interface NewPoolDao {
    @Query("SELECT * FROM new_pool")
    fun observeAll(): Flow<List<NewPoolEntity>>

    @Upsert
    suspend fun upsert(item: NewPoolEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<NewPoolEntity>)

    @Query("DELETE FROM new_pool WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM new_pool WHERE deckId = :deckId")
    suspend fun deleteByDeck(deckId: String)

    @Query("DELETE FROM new_pool")
    suspend fun clear()
}

@Dao
interface ReviewLogDao {
    @Insert
    suspend fun insert(entry: ReviewLogEntity)

    @Query("DELETE FROM review_log")
    suspend fun clear()
}

@Dao
interface SettingsDao {
    @Query("SELECT * FROM settings WHERE id = 0")
    fun observe(): Flow<SettingsEntity?>

    @Upsert
    suspend fun upsert(settings: SettingsEntity)

    @Query("DELETE FROM settings")
    suspend fun clear()
}

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE id = 0")
    fun observe(): Flow<SyncStateEntity?>

    @Upsert
    suspend fun upsert(state: SyncStateEntity)

    @Query("DELETE FROM sync_state")
    suspend fun clear()
}
