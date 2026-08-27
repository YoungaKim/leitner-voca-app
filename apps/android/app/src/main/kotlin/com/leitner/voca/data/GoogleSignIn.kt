package com.leitner.voca.data

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

// 2c — Credential Manager로 구글 ID 토큰을 받아온다. Supabase의 Google Auth 프로바이더가
// Config.GOOGLE_WEB_CLIENT_ID와 짝인 클라이언트로 이미 설정돼있어서, 이 ID 토큰을 그대로
// AuthRepository.signInWithGoogleIdToken에 넘기면 세션이 선다.
suspend fun requestGoogleIdToken(context: Context): String {
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(Config.GOOGLE_WEB_CLIENT_ID)
        .setFilterByAuthorizedAccounts(false)
        .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val credentialManager = CredentialManager.create(context)
    val result = credentialManager.getCredential(context, request)
    val credential = result.credential
    require(credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        "예상치 못한 인증 정보 형식입니다."
    }
    return GoogleIdTokenCredential.createFrom(credential.data).idToken
}
