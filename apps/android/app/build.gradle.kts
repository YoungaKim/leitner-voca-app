import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("org.jetbrains.kotlin.plugin.serialization") // 2c: supabase-kt 모델 직렬화에 필요
    id("com.google.firebase.appdistribution") // 배포: Firebase App Distribution 업로드
}

// 서명 키(release.keystore)와 비밀번호는 keystore.properties에 두고 git에서 제외한다.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// Firebase App ID 등 배포 설정도 gitignore된 파일에서 읽는다.
val distProps = Properties().apply {
    val f = rootProject.file("appdistribution.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// versionCode를 git 커밋 수로 자동 증가시켜, 새로 빌드할 때마다 덮어쓰기 설치가 되게 한다.
val gitCommitCount: Int = try {
    val p = ProcessBuilder("git", "rev-list", "--count", "HEAD")
        .directory(rootProject.projectDir)
        .redirectErrorStream(true)
        .start()
    p.inputStream.bufferedReader().readText().trim().toInt().also { p.waitFor() }
} catch (_: Exception) {
    1
}

android {
    namespace = "com.leitner.voca"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.leitner.voca"
        minSdk = 26
        targetSdk = 35
        versionCode = gitCommitCount
        versionName = "0.1.$gitCommitCount"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // keystore.properties가 있을 때만 release 서명 적용(없으면 unsigned).
            signingConfig = signingConfigs.findByName("release")
            firebaseAppDistribution {
                appId = distProps.getProperty("appId") ?: ""
                artifactType = "APK"
                groups = distProps.getProperty("groups") ?: "testers"
                releaseNotes = "자동 빌드 v0.1.$gitCommitCount"
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Room — DESIGN §4 "Android: Room(SQLite)" 로컬 저장.
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // 2c — 기기 간 동기화: 구글 로그인(Credential Manager) + Supabase(PC 웹과 같은 프로젝트).
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    implementation(platform("io.github.jan-tennert.supabase:bom:3.0.3"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.github.jan-tennert.supabase:functions-kt") // 2d — content-sync-proxy Edge Function 호출(PC 웹과 동일)
    implementation("io.ktor:ktor-client-okhttp:3.0.2") // supabase-kt:3.0.3이 요구하는 Ktor 버전과 맞춤
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation("junit:junit:4.13.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
