package com.leitner.voca.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class UserFacingErrorTest {
    @Test
    fun `HTTP 오류의 토큰과 요청 상세는 UI에 노출되지 않는다`() {
        val detail = "Unable to resolve host\nAuthorization=[Bearer secret-token]\napikey=[secret-key]"
        val message = userFacingSaveError(RuntimeException(detail))
        assertEquals("서버에 저장하지 못했습니다. 연결을 확인하고 동기화 후 다시 시도하세요.", message)
        assertFalse(message.contains("secret"))
        assertFalse(message.contains("Authorization"))
    }

    @Test
    fun `버전 충돌은 요청 헤더 없이 복구 방법을 안내한다`() {
        val message = userFacingSaveError(RuntimeException(
            "Card changed on another device. Sync and retry.\nAuthorization=[Bearer secret-token]"
        ))
        assertEquals("다른 기기에서 이 카드가 변경됐습니다. 홈으로 돌아가 동기화한 뒤 다시 학습하세요.", message)
        assertFalse(message.contains("secret"))
    }
}
