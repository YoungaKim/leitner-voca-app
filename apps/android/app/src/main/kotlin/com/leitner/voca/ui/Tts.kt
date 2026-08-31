package com.leitner.voca.ui

import android.speech.tts.TextToSpeech
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import java.util.Locale

// '듣기' — PC 웹 lib/tts.ts(브라우저 speechSynthesis)에 대응하는 안드로이드 네이티브 TTS.
// 영어(US) 문장을 읽어준다. 엔진 미탑재 등으로 초기화에 실패하면 speak 호출은 조용히 무시된다
// (PC 웹에서 speechSynthesis 없는 환경을 무시하는 것과 동일 원칙).

/** 화면 생존 동안 하나의 TextToSpeech 인스턴스를 잡고, 문장을 읽는 람다를 돌려준다. */
@Composable
fun rememberSpeaker(): (String) -> Unit {
    val context = LocalContext.current
    val holder = remember { TtsHolder() }

    DisposableEffect(Unit) {
        holder.tts = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                holder.tts?.language = Locale.US
                // 속도/피치는 지정하지 않는다 — 기기 시스템 TTS 설정(설정 → TTS 출력 → 음성 속도)을 그대로 따른다.
                holder.ready = true
            }
        }
        onDispose {
            holder.tts?.stop()
            holder.tts?.shutdown()
            holder.tts = null
            holder.ready = false
        }
    }

    return { text ->
        if (holder.ready && text.isNotBlank()) {
            holder.tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "voca-tts")
        }
    }
}

private class TtsHolder {
    var tts: TextToSpeech? = null
    var ready: Boolean = false
}
