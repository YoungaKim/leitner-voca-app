package com.leitner.voca.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.leitner.voca.data.AppRepository
import com.leitner.voca.domain.Card
import com.leitner.voca.domain.Deck
import com.leitner.voca.domain.NewPoolItem
import com.leitner.voca.domain.ReviewLog
import com.leitner.voca.domain.Settings
import com.leitner.voca.domain.SyncState
import com.leitner.voca.domain.today
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

// PC 웹 store.ts(zustand)와 대응되는 화면 상태 저장소. Room Flow 4개를 하나의 UiState로
// combine해서 노출하고, 액션은 리포지토리로 위임한다.

data class AppUiState(
    val loaded: Boolean = false,
    val decks: List<Deck> = emptyList(),
    val cards: List<Card> = emptyList(),
    val newPool: List<NewPoolItem> = emptyList(),
    val settings: Settings = Settings.DEFAULT,
    val syncState: SyncState = SyncState.DEFAULT,
)

class AppViewModel(private val repo: AppRepository) : ViewModel() {

    val uiState: StateFlow<AppUiState> = combine(
        repo.decks, repo.cards, repo.newPool, repo.settings, repo.syncState,
    ) { decks, cards, newPool, settings, syncState ->
        AppUiState(loaded = true, decks = decks, cards = cards, newPool = newPool, settings = settings, syncState = syncState)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), AppUiState())

    fun addDeck(name: String) = viewModelScope.launch { repo.addDeck(name) }

    fun deleteDeck(id: String) = viewModelScope.launch { repo.deleteDeck(id) }

    fun addCard(deckId: String, promptKo: String, answerEn: String, chunkNote: String?) =
        viewModelScope.launch { repo.addCard(deckId, promptKo, answerEn, chunkNote?.ifBlank { null }, today()) }

    fun deleteCard(id: String) = viewModelScope.launch { repo.deleteCard(id) }

    fun applyReview(cardId: String, updated: Card, log: ReviewLog) =
        viewModelScope.launch { repo.applyReview(updated, log) }

    fun introduceCard(card: Card, poolId: String) = viewModelScope.launch { repo.introduceCard(card, poolId) }

    fun updateSettings(settings: Settings) = viewModelScope.launch { repo.updateSettings(settings) }

    /** 2d — "지금 동기화". 결과는 콜백으로 화면에 전달(성공/오류 메시지 표시용, PC 웹의
     * contentSyncing/contentSyncErrors 상태와 동일 역할을 화면 쪽 로컬 상태로 대신한다). */
    fun syncContentNow(sourceUrl: String, targetDeckId: String, onResult: (com.leitner.voca.data.ContentSyncResult) -> Unit) {
        viewModelScope.launch { onResult(repo.syncContentNow(sourceUrl, targetDeckId)) }
    }
}
