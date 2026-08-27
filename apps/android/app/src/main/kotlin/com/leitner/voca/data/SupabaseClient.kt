package com.leitner.voca.data

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest

fun buildSupabaseClient() = createSupabaseClient(
    supabaseUrl = Config.SUPABASE_URL,
    supabaseKey = Config.SUPABASE_ANON_KEY,
) {
    install(Auth)
    install(Postgrest)
    install(Functions) // 2d — content-sync-proxy Edge Function 호출(PC 웹과 동일)
}
