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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
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
                            LaunchedEffect(s.session.user?.id) {
                                s.session.user?.id?.let(authViewModel::onAuthenticated)
                            }
                            AuthenticatedApp(app, onSignOut = authViewModel::signOut)
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
private fun AuthenticatedApp(app: VocaApplication, onSignOut: () -> Unit) {
    val viewModel: AppViewModel = viewModel(
        factory = viewModelFactory { initializer { AppViewModel(app.repository) } },
    )
    val state by viewModel.uiState.collectAsState()
    val navController = rememberNavController()

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
                    onClose = { navController.popBackStack("home", inclusive = false) },
                )
            }
        }
    }
}
