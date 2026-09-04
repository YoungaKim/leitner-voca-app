package com.leitner.voca

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.leitner.voca.ui.AppViewModel
import com.leitner.voca.ui.AuthViewModel
import com.leitner.voca.ui.DeckDetailScreen
import com.leitner.voca.ui.DecksScreen
import com.leitner.voca.ui.HomeScreen
import com.leitner.voca.ui.LoginScreen
import com.leitner.voca.ui.SettingsScreen
import com.leitner.voca.ui.StudySessionScreen
import io.github.jan.supabase.auth.status.SessionStatus

// 2c — 로그인 게이트(PC 웹 App.tsx와 동일 원칙: 로그인 전엔 로고+버튼만) + UXUI §3 홈/단어장/학습
// 3개 라우트를 NavHost로 연결(요약은 학습 화면 안에서 상태로 처리).
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as VocaApplication
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val authViewModel: AuthViewModel = viewModel(
                        factory = viewModelFactory { initializer { AuthViewModel(app.authRepository, app.repository) } },
                    )
                    val session by authViewModel.sessionStatus.collectAsState()
                    val signingIn by authViewModel.signingIn.collectAsState()
                    val error by authViewModel.error.collectAsState()
                    val context = LocalContext.current

                    when (val s = session) {
                        is SessionStatus.Authenticated -> {
                            val userId = s.session.user?.id
                            LaunchedEffect(userId) {
                                userId?.let(authViewModel::onAuthenticated)
                            }
                            AuthenticatedApp(
                                app = app,
                                userId = userId,
                                onResumed = authViewModel::onResumed,
                                onSignOut = authViewModel::signOut,
                            )
                        }
                        else -> {
                            LoginScreen(loading = signingIn, error = error, onSignIn = { authViewModel.signIn(context) })
                        }
                    }
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun AuthenticatedApp(
    app: VocaApplication,
    userId: String?,
    onResumed: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    val viewModel: AppViewModel = viewModel(
        factory = viewModelFactory { initializer { AppViewModel(app.repository) } },
    )
    val state by viewModel.uiState.collectAsState()
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val inSession = backStackEntry?.destination?.route == "session"

    // DESIGN §3.9 — 진행 상태 pull은 "앱 시작 또는 포그라운드 복귀 시 1회". 로그인 시점
    // 1회만으론, 앱을 계속 로그인해둔 채 백그라운드↔포그라운드만 오가면(다시 로그인 이벤트가
    // 안 일어나므로) PC에서 방금 추가한 카드 등이 안 보인다 — 화면 복귀 때마다 재당김.
    // 학습 세션 중엔 큐가 로컬 상태로 진행 중이라 건너뛴다(진행 중 카드 목록이 바뀌는 것 방지).
    val lifecycleOwner = LocalLifecycleOwner.current
    val inSessionState = rememberUpdatedState(inSession)
    val userIdState = rememberUpdatedState(userId)
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && !inSessionState.value) {
                userIdState.value?.let(onResumed)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    if (!state.loaded) {
        Text("불러오는 중...")
        return
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(8.dp),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onSignOut) { Text("로그아웃") }
        }
        NavHost(navController = navController, startDestination = "home", modifier = Modifier.weight(1f)) {
            composable("home") {
                HomeScreen(
                    state = state,
                    onStartSession = { navController.navigate("session") },
                    onGoDecks = { navController.navigate("decks") },
                    onOpenSettings = { navController.navigate("settings") },
                )
            }
            composable("decks") {
                DecksScreen(
                    state = state,
                    onAddDeck = viewModel::addDeck,
                    onDeleteDeck = viewModel::deleteDeck,
                    onOpenDeck = { deckId -> navController.navigate("decks/$deckId") },
                    onOpenSettings = { navController.navigate("settings") },
                )
            }
            composable("settings") {
                SettingsScreen(
                    state = state,
                    onUpdateSettings = viewModel::updateSettings,
                    onSyncNow = viewModel::syncContentNow,
                )
            }
            composable("decks/{deckId}") { backStackEntry ->
                val deckId = backStackEntry.arguments?.getString("deckId") ?: return@composable
                DeckDetailScreen(
                    deckId = deckId,
                    state = state,
                    onAddCard = viewModel::addCard,
                    onDeleteCard = viewModel::deleteCard,
                )
            }
            composable("session") {
                StudySessionScreen(
                    state = state,
                    onApplyReview = viewModel::applyReview,
                    onIntroduce = viewModel::introduceCard,
                    onAskTeacher = viewModel::askTeacher,
                    onClose = { navController.popBackStack("home", inclusive = false) },
                )
            }
        }
    }
}
