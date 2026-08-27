package com.leitner.voca.data

// 2c — PC 웹과 같은 Supabase 프로젝트/구글 OAuth 클라이언트를 그대로 재사용한다(같은 계정이면
// 폰/PC가 같은 데이터를 봐야 하므로 당연히 같은 백엔드를 가리켜야 함).
// anon key(publishable key)와 OAuth 클라이언트 ID는 공개돼도 안전한 값 — RLS가 실제 접근 제어를
// 맡고, client secret은 여기 안 들어간다(그건 Supabase 대시보드 쪽에만 있음).
object Config {
    const val SUPABASE_URL = "https://azayzkelmufcrjkivwdx.supabase.co"
    const val SUPABASE_ANON_KEY = "sb_publishable_xOO593D2CkVFHVPwA0kTJA_RQuvuACD"
    const val GOOGLE_WEB_CLIENT_ID = "342012785824-257837tsu0ifdoghoevi1rsvvhm858km.apps.googleusercontent.com"
}
