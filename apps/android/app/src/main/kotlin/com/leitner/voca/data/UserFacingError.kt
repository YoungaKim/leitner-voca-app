package com.leitner.voca.data

/** SDK exceptions can contain request headers, including the bearer token.
 * Only fixed, actionable messages may cross into UI or shared sync summaries. */
fun userFacingSaveError(error: Throwable): String =
    if (error.message?.contains("Card changed on another device.") == true) {
        "다른 기기에서 이 카드가 변경됐습니다. 홈으로 돌아가 동기화한 뒤 다시 학습하세요."
    } else {
        "서버에 저장하지 못했습니다. 연결을 확인하고 동기화 후 다시 시도하세요."
    }
