// 2b. Android 앱 루트 빌드 설정 — 각 플러그인은 app 모듈에서 apply, 여기선 버전만 고정.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.28" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    id("com.google.firebase.appdistribution") version "5.1.1" apply false
}
