package com.leitner.voca

import android.app.Application
import androidx.room.Room
import com.leitner.voca.data.AppDatabase
import com.leitner.voca.data.AppRepository
import com.leitner.voca.data.AuthRepository
import com.leitner.voca.data.SyncRepository
import com.leitner.voca.data.buildSupabaseClient

// 별도 DI 프레임워크 없이 애플리케이션 싱글턴으로 DB/리포지토리를 하나만 만들어 공유한다 —
// 앱 규모(2b~2c 범위)에서는 Hilt 등을 끌어올 필요가 없다고 판단.
class VocaApplication : Application() {
    lateinit var authRepository: AuthRepository
        private set
    lateinit var repository: AppRepository
        private set

    override fun onCreate() {
        super.onCreate()
        // 정식 마이그레이션 경로는 아직 안 만들어놨다 — 출시 전(2b~2c 개발 단계)이라 스키마가
        // 계속 바뀌는 중이라, 당장은 파괴적 마이그레이션(로컬 캐시 초기화)으로 충분하다. 실사용
        // 데이터가 생기기 시작하면 Migration 객체를 추가해 교체해야 한다.
        val db = Room.databaseBuilder(this, AppDatabase::class.java, "leitner-voca.db")
            .fallbackToDestructiveMigration()
            .build()
        val supabase = buildSupabaseClient()
        authRepository = AuthRepository(supabase)
        val syncRepository = SyncRepository(supabase)
        repository = AppRepository(db, authRepository, syncRepository, supabase, applicationContext)
    }
}
