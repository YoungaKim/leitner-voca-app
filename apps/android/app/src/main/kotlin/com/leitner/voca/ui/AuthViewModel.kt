package com.leitner.voca.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.leitner.voca.data.AppRepository
import com.leitner.voca.data.AuthRepository
import com.leitner.voca.data.requestGoogleIdToken
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

// PC 웹 lib/auth.ts + App.tsx의 로그인 게이트/동기화 트리거 로직과 대응.
class AuthViewModel(private val authRepo: AuthRepository, private val appRepo: AppRepository) : ViewModel() {

    val sessionStatus: StateFlow<SessionStatus> = authRepo.sessionStatus
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SessionStatus.Initializing)

    private val _signingIn = MutableStateFlow(false)
    val signingIn: StateFlow<Boolean> = _signingIn

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private var syncedUserId: String? = null
    private var syncing = false

    fun signIn(context: Context) {
        if (_signingIn.value) return
        _signingIn.value = true
        _error.value = null
        viewModelScope.launch {
            try {
                val idToken = requestGoogleIdToken(context)
                authRepo.signInWithGoogleIdToken(idToken)
            } catch (e: Exception) {
                _error.value = e.message ?: "로그인에 실패했습니다."
            } finally {
                _signingIn.value = false
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authRepo.signOut()
            appRepo.clearAllLocal()
            syncedUserId = null
        }
    }

    /** 로그인이 확인될 때마다(세션 상태가 Authenticated로 바뀔 때) 1회만 클라우드 병합을 트리거한다. */
    fun onAuthenticated(userId: String) {
        if (syncedUserId == userId) return
        syncedUserId = userId
        runMergeFromCloud(userId)
    }

    /** DESIGN §3.9 — 진행 상태(카드/box 등) pull은 "앱 시작 또는 포그라운드 복귀 시 1회".
     * onAuthenticated는 로그인 시점 1회뿐이라, 앱이 계속 로그인된 채로 백그라운드↔포그라운드만
     * 오가면(로그인 이벤트가 다시 안 일어나므로) 다른 기기(PC)에서 바뀐 내용이 안 보인다 —
     * 화면이 다시 보일 때(ON_RESUME)마다 이걸 불러 재당김한다. */
    fun onResumed(userId: String) {
        runMergeFromCloud(userId)
    }

    private fun runMergeFromCloud(userId: String) {
        if (syncing) return
        syncing = true
        viewModelScope.launch {
            runCatching { appRepo.mergeFromCloud(userId) }
                .onFailure { _error.value = "동기화 실패: ${it.message}" }
            syncing = false
        }
    }
}
