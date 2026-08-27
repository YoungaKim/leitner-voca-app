package com.leitner.voca.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken
import kotlinx.coroutines.flow.StateFlow

// 2c — PC 웹 lib/auth.ts와 대응. 구글 ID 토큰(Credential Manager에서 받아옴)을 Supabase Auth에
// 넘겨 세션을 세운다 — Supabase의 Google Auth 프로바이더가 이미 PC 웹 로그인 때 설정돼있어서
// (Config.GOOGLE_WEB_CLIENT_ID와 짝인 client id/secret), 별도 서버 설정 추가 없이 그대로 통한다.
class AuthRepository(private val supabase: SupabaseClient) {

    val sessionStatus: StateFlow<SessionStatus> = supabase.auth.sessionStatus

    fun currentUserId(): String? = supabase.auth.currentUserOrNull()?.id

    suspend fun signInWithGoogleIdToken(idToken: String) {
        supabase.auth.signInWith(IDToken) {
            this.idToken = idToken
            provider = Google
        }
    }

    suspend fun signOut() {
        supabase.auth.signOut()
    }
}
